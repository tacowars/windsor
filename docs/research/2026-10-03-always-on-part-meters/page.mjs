/** windsor#533's page, bundled by bench.mjs and driven over the DevTools protocol. One
 * case and variant a page: the 16-part song through the engine's own AudioSystem, or 16
 * looping sources; the shipped meter per part, or one research node with 16 inputs. The
 * graph plays throughout and only the meters change: `setMeters(n)` meters the first n
 * parts and marks the moment in the trace (`performance.mark`), so one page compares
 * every N against N = 0 on the same context, thread and song.
 * The song case plays as the app's host does (`packages/app/src/host.ts`): FmEngine,
 * AudioSystem, initMusic, unlock, startMusic and the 25 ms pump. Its separate meters are
 * the strips' own (`PartStrip.meter.setActive`), as the Song mixer lights them.
 */
/* global window, fetch, performance, setInterval, navigator */
/* global AudioContext, OfflineAudioContext, AudioBuffer, AudioBufferSourceNode, GainNode */
import {
  AudioSystem,
  FmEngine,
  makeArrangement,
  musicPartName,
  songTicks,
} from '../../../packages/engine/src/index.ts';
import { createPeakMeter } from '../../../packages/engine/src/mixer/peakMeter.ts';
import { PEAK_METER_WORKLET_URL } from '../../../packages/engine/src/synth/workletMessages.ts';
import { HOST_PUMP_INTERVAL_MS } from '../../../packages/app/src/hostConstants.ts';
import { renderProgram } from '../2026-09-30-tape-browser-cost/program.ts';
import { COST } from '../2026-09-30-tape-browser-cost/costConstants.ts';
import { BENCH } from './benchConstants.mjs';
import { createMultiMeter } from './multiMeter.mjs';

const MULTI_URL = '/multi-meter.js';
const MS_PER_SECOND = 1000;
let live = null;

/** #211's deterministic program, rendered at the context's rate: the isolated sources' signal. */
function programBuffer(rate) {
  const program = renderProgram(COST.program, rate);
  const buffer = new AudioBuffer({
    numberOfChannels: 2,
    length: program.left.length,
    sampleRate: rate,
  });
  buffer.copyToChannel(program.left, 0);
  buffer.copyToChannel(program.right, 1);
  return buffer;
}

/** 16 looping stereo sources, summed through one gain into the destination. */
function isolatedSources(ctx, buffer) {
  const sum = new GainNode(ctx, { gain: BENCH.sourceGain });
  sum.connect(ctx.destination);
  return Array.from({ length: BENCH.parts }, () => {
    const source = new AudioBufferSourceNode(ctx, { buffer, loop: true });
    source.connect(sum);
    source.start();
    return source;
  });
}

async function isolated(ctx) {
  await ctx.audioWorklet.addModule(PEAK_METER_WORKLET_URL);
  await ctx.audioWorklet.addModule(MULTI_URL);
  const taps = isolatedSources(ctx, programBuffer(ctx.sampleRate));
  return {
    taps,
    shipped: taps.map((tap) => createPeakMeter(ctx, tap)),
    start: () => ctx.resume(),
  };
}

async function song(ctx) {
  // Looped, so a pass of any length plays, and normalised as the console loads an
  // imported song (`documentModel.ts`).
  const raw = await (await fetch('/song.json')).json();
  const loop = { start: 0, end: songTicks(raw.transport.bars), on: true };
  const made = makeArrangement({ ...raw, transport: { ...raw.transport, loop } });
  if (!made.usable) throw Error(`song refused: ${made.corrections.join('; ')}`);
  const { document } = made;
  const engine = new FmEngine(ctx);
  await engine.init();
  const system = new AudioSystem(engine);
  await system.init();
  system.initMusic(document);
  engine.setLiveRetune(true);
  await ctx.audioWorklet.addModule(MULTI_URL);
  const strips = document.parts.map((part) => system.strip(musicPartName(part.slot)));
  return {
    taps: strips.map((strip) => strip.rotation.output),
    shipped: strips.map((strip) => strip.meter),
    start: async () => {
      await system.unlock();
      system.startMusic();
      setInterval(
        () => system.update(HOST_PUMP_INTERVAL_MS / MS_PER_SECOND),
        HOST_PUMP_INTERVAL_MS,
      );
    },
  };
}

/** Meter the first n parts: their shipped meters, or one multi node fed by their taps. */
function meter(state, n) {
  if (state.variant === 'separate') {
    state.built.shipped.forEach((m, k) => m.setActive(k < n));
    return;
  }
  state.multi?.dispose();
  state.multi =
    n > 0 ? createMultiMeter(state.ctx, state.built.taps.slice(0, n), BENCH.parts) : null;
}

/** Reports received so far by the meters now running (a stopped shipped meter counts its stop). */
function messages(state) {
  if (state.variant === 'multi') return state.multi?.revision ?? 0;
  return state.built.shipped.reduce((sum, m) => sum + m.revision, 0);
}

function counters() {
  return {
    messages: messages(live),
    wallMs: performance.now(),
    audioSeconds: live.ctx.currentTime,
    state: live.ctx.state,
    outputLatency: live.ctx.outputLatency,
  };
}

/** Switch to n meters; the counters either side, and a trace mark at the switch. */
function setMeters(n) {
  const before = counters();
  meter(live, n);
  performance.mark(`meters:${n}`);
  return { before, after: counters() };
}

async function setup(config) {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const built = config.case === 'song' ? await song(ctx) : await isolated(ctx);
  live = { ctx, built, variant: config.variant, multi: null };
  await built.start();
  return {
    sampleRate: ctx.sampleRate,
    baseLatency: ctx.baseLatency,
    state: ctx.state,
    userAgent: navigator.userAgent,
  };
}

/** #211's offline method: the isolated graph rendered for a fixed length, timed from here. */
async function offline(config) {
  const { sampleRate, seconds } = BENCH.offline;
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: sampleRate * seconds,
    sampleRate,
  });
  live = { ctx, built: await isolated(ctx), variant: config.variant, multi: null };
  meter(live, config.n);
  const start = performance.now();
  await ctx.startRendering();
  const renderMs = performance.now() - start;
  const quanta = (sampleRate * seconds) / BENCH.quantumFrames;
  return { renderMs, quanta, msPerQuantum: renderMs / quanta, messages: messages(live) };
}

window.bench = { setup, setMeters, counters, offline };
