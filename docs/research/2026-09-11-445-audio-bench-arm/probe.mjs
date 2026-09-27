#!/usr/bin/env node
/* global process, console */
// #445 part-2 probe: which audio-load measurement path this browser offers.
//
// Asks one Chrome, on a real page over http (an AudioWorklet module will not
// load from file://), the ticket's three questions in order of preference:
//
//   (a) Does `AudioContext.renderCapacity` exist (the spec's
//       `AudioRenderCapacity`: `averageLoad`, `peakLoad`, `underrunRatio` per
//       interval), and does it fire `update` on a running context?
//   (b) Does `AudioWorkletGlobalScope` expose `performance.now()`, so a
//       processor can time its own `process()` call?
//   (c) If neither: what IS measurable from inside the processor? Stage 2
//       answers that — `Date` is a JS built-in and exists in every global
//       scope, so the fallback is a **duty-cycle sampler**: count the integer
//       millisecond boundaries that fall inside `process()` over a report
//       interval and divide by the wall milliseconds of that interval. Stage 2
//       validates the estimator against synthetic loads of known duty cycle.
//
// Run:  node docs/research/2026-09-11-445-audio-bench-arm/probe.mjs
// Prints one JSON object per stage. Chrome is launched with the same
// throwaway profile and log-poll retrieval the bench runner uses
// (`scripts/lib/benchChrome.mjs`) plus `--autoplay-policy=no-user-gesture-
// required`, which is exactly the flag the audio bench arm adds — so a
// successful probe also proves the flag.
import { createServer } from 'node:http';
import { launchChrome, readLogLine, sleep } from '../../../scripts/lib/benchChrome.mjs';

/** Stage 1: capability. */
const STAGE1 = `
const out = { stage: 1, userAgent: navigator.userAgent };
const blob = new Blob([\`
class ProbeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.postMessage({
      scope: {
        performance: typeof performance,
        performanceNow: typeof performance !== 'undefined' && typeof performance.now,
        Date: typeof Date,
        dateNow: typeof Date !== 'undefined' && typeof Date.now,
        currentFrame: typeof currentFrame,
        currentTime: typeof currentTime,
        sampleRate,
      },
    });
  }
  process() { return true; }
}
registerProcessor('a204-probe', ProbeProcessor);
\`], { type: 'text/javascript' });
const ctx = new AudioContext({ latencyHint: 'interactive' });
out.sampleRate = ctx.sampleRate;
out.baseLatency = ctx.baseLatency;
out.quantumBudgetMs = (128 / ctx.sampleRate) * 1000;
out.renderCapacityInPrototype = 'renderCapacity' in AudioContext.prototype;
out.renderCapacityType = typeof ctx.renderCapacity;
await ctx.audioWorklet.addModule(URL.createObjectURL(blob));
const node = new AudioWorkletNode(ctx, 'a204-probe', { numberOfInputs: 0, numberOfOutputs: 1 });
node.connect(ctx.destination);
const messages = [];
node.port.onmessage = (e) => messages.push(e.data);
const events = [];
if (ctx.renderCapacity) {
  ctx.renderCapacity.onupdate = (e) => events.push({
    timestamp: e.timestamp, averageLoad: e.averageLoad,
    peakLoad: e.peakLoad, underrunRatio: e.underrunRatio,
  });
  ctx.renderCapacity.start({ updateInterval: 0.5 });
}
await ctx.resume();
out.contextState = ctx.state;
const wall0 = performance.now();
const audio0 = ctx.currentTime;
await new Promise((r) => setTimeout(r, 3000));
// Does the audio clock track the wall clock? If it does, main-thread drift is
// not a glitch detector and the readout must come from inside the processor.
out.clockDriftMs = (performance.now() - wall0) - (ctx.currentTime - audio0) * 1000;
out.workletMessages = messages;
out.renderCapacityEvents = events;
out.contextStateEnd = ctx.state;
return out;
`;

/**
 * Stage 2: does the Date.now() duty-cycle sampler measure a known load?
 * The processor burns a target fraction of its 128-frame quantum budget in a
 * spin loop calibrated by trial, and reports the estimator's answer. Truth is
 * the requested duty cycle; a working estimator lands near it.
 */
const STAGE2 = `
const out = { stage: 2, trials: [] };
const blob = new Blob([\`
const QUANTUM = 128;
class LoadProbeProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.spin = o.spin | 0;
    this.intervalQuanta = o.intervalQuanta | 0;
    this.quanta = 0;
    this.crossings = 0;
    this.peak = 0;
    this.sink = 0;
    this.wallStart = Date.now();
  }
  process() {
    const t0 = Date.now();
    let s = this.sink;
    for (let i = 0; i < this.spin; i++) s += Math.sin(i) * Math.cos(i);
    this.sink = s;
    const t1 = Date.now();
    const crossed = t1 - t0;
    this.crossings += crossed;
    if (crossed > this.peak) this.peak = crossed;
    if (++this.quanta >= this.intervalQuanta) {
      this.port.postMessage({
        crossings: this.crossings,
        peak: this.peak,
        quanta: this.quanta,
        wallMs: t1 - this.wallStart,
        audioMs: (this.quanta * QUANTUM / sampleRate) * 1000,
      });
      this.quanta = 0; this.crossings = 0; this.peak = 0; this.wallStart = t1;
    }
    return true;
  }
}
registerProcessor('a204-load-probe', LoadProbeProcessor);
\`], { type: 'text/javascript' });
const url = URL.createObjectURL(blob);
// A fresh context per trial, closed after it: a disconnected worklet node is
// still rendered until it is collected, so reusing one context lets earlier
// trials' spin loops contend with later ones (seen on the first run).
for (const spin of [0, 2000, 10000, 40000]) {
  // Main-thread reference: the same loop, timed with performance.now(), so the
  // estimator's answer can be checked against a real duration.
  let sink = 0;
  const ref0 = performance.now();
  for (let k = 0; k < 1000; k++) for (let i = 0; i < spin; i++) sink += Math.sin(i) * Math.cos(i);
  const refMsPerCall = (performance.now() - ref0) / 1000;
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(url);
  await ctx.resume();
  out.sampleRate = ctx.sampleRate;
  out.quantumBudgetMs = (128 / ctx.sampleRate) * 1000;
  const node = new AudioWorkletNode(ctx, 'a204-load-probe', {
    numberOfInputs: 0, numberOfOutputs: 1,
    processorOptions: { spin, intervalQuanta: Math.round(ctx.sampleRate / 128) },
  });
  const reports = [];
  node.port.onmessage = (e) => reports.push(e.data);
  node.connect(ctx.destination);
  await new Promise((r) => setTimeout(r, 3500));
  node.disconnect();
  await ctx.close();
  out.trials.push({
    spin,
    refMsPerCall: +refMsPerCall.toFixed(4),
    // Truth: the reference duration as a fraction of the quantum budget.
    trueLoadPct: +((refMsPerCall / out.quantumBudgetMs) * 100).toFixed(1),
    reports: reports.map((r) => ({
      ...r,
      estimatedLoadPct: +((r.crossings / r.wallMs) * 100).toFixed(1),
      estimatedPeakPct: +((r.peak / out.quantumBudgetMs) * 100).toFixed(1),
    })),
  });
}
return out;
`;

const page = (body) => `<!doctype html><meta charset="utf-8"><title>a204 audio probe</title>
<body><script type="module">
const run = async () => { ${body} };
run().then((out) => console.log('A204_BENCH ' + JSON.stringify(out)))
     .catch((err) => console.log('A204_BENCH ' + JSON.stringify({ error: String(err) })));
</script></body>`;

async function runStage(body) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  // The same flag the audio bench arm runs under, through the same option, so
  // a successful probe also proves the flag (`benchChrome.mjs` AUTOPLAY_FLAG).
  const chrome = launchChrome(url, { backend: 'webgl2', autoplay: true });
  try {
    let raw = null;
    for (let i = 0; i < 15 && !raw; i++) {
      await sleep(2000);
      raw = readLogLine(chrome.profile);
    }
    if (!raw) throw new Error('no A204_BENCH line from the probe page');
    return JSON.parse(raw);
  } finally {
    await chrome.close();
    server.close();
  }
}

const only = process.argv[2];
if (only !== '2') console.log(JSON.stringify(await runStage(STAGE1), null, 2));
if (only !== '1') console.log(JSON.stringify(await runStage(STAGE2), null, 2));
