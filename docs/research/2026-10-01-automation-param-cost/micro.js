// The windsor#343 node-only bench: 16 FM part nodes with no notes, rendered
// offline, so the parameters' cost is not buried under the voices'.
//
// The song render (`probe.js`, `offline`) is the issue's measure, but on a
// shared machine its run-to-run spread (about ±20 %) is larger than what
// the parameters cost. Here the processors render silence: every voice is
// idle, so a quantum is the processor's call, its parameter handling and
// Chrome's, and the difference between cases is the parameters alone.
//
// Each render is `seconds` of audio at 48 kHz, 16 nodes into the destination,
// stopped every 0.25 s as the song render stops (`RENDER_STEP_SECONDS`).
// Case d writes its 8 lanes' bent ramps at each stop, one per lane per tick
// at 124 bpm, up to 0.5 s ahead (`RENDER_LOOK_AHEAD_SECONDS`), as the song
// render's automation player would; the stops are the same in every case.
//
//   const m = await import('/@fs/<worktree>/docs/research/2026-10-01-automation-param-cost/micro.js');
//   m.start(fmProcessorUrl, runs, seconds);   // result on window.__micro
/* global window, performance, OfflineAudioContext, AudioWorkletNode, navigator */

const RATE = 48000;
const PARTS = 16;
const STEP = 0.25;
const AHEAD = 0.5;
const TICK = 60 / 124 / 24;
const names = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const CASES = {
  a: { processor: 'fm-part', lanes: [] },
  b: { processor: 'fm-part-p29', lanes: names('target', 29) },
  c: { processor: 'fm-part-p8', lanes: names('slot', 8) },
  d: { processor: 'fm-part-p8', lanes: names('slot', 8), ramp: true },
  // b and c with the parameters declared but never read in `renderBlock`:
  // what is left is Chrome's own handling of them.
  e: { processor: 'fm-part-p29-unread', lanes: names('target', 29) },
  f: { processor: 'fm-part-p8-unread', lanes: names('slot', 8) },
};

const value = (lane, tick) => {
  const beat = Math.floor(tick / 24);
  const from = Math.sin(beat * 1.7 + lane * 0.9) * 0.5;
  const to = Math.sin((beat + 1) * 1.7 + lane * 0.9) * 0.5;
  const bend = Math.sin(beat * 0.37 + lane * 1.3);
  return from + (to - from) * Math.pow((tick % 24) / 24, Math.pow(2, 3 * bend));
};

async function render(url, name, seconds) {
  const spec = CASES[name];
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: RATE * seconds, sampleRate: RATE });
  await context.audioWorklet.addModule(url);
  const parts = [];
  for (let i = 0; i < PARTS; i++) {
    const node = new AudioWorkletNode(context, spec.processor, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { maxVoices: 16 },
    });
    node.connect(context.destination);
    parts.push({ params: spec.lanes.map((lane) => node.parameters.get(lane)), next: 0 });
  }
  const sched = { calls: 0, ms: 0 };
  const pump = () => {
    if (!spec.ramp) return;
    const t0 = performance.now();
    const horizon = context.currentTime + AHEAD;
    for (const part of parts) {
      while (part.next * TICK <= horizon) {
        const tick = part.next++;
        for (let lane = 0; lane < part.params.length; lane++) {
          part.params[lane].linearRampToValueAtTime(value(lane, tick), tick * TICK);
          sched.calls++;
        }
      }
    }
    sched.ms += performance.now() - t0;
  };
  const stopAt = (time) => {
    void context.suspend(time).then(() => {
      pump();
      if (time + STEP < seconds) stopAt(time + STEP);
      return context.resume();
    });
  };
  pump();
  stopAt(STEP);
  const start = performance.now();
  await context.startRendering();
  return { ms: performance.now() - start, sched };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 1) => +x.toFixed(d);

async function bench(url, runs, seconds) {
  await render(url, 'a', seconds);
  const keys = Object.keys(CASES);
  const times = Object.fromEntries(keys.map((k) => [k, []]));
  let sched = null;
  for (let run = 0; run < runs; run++) {
    // Rotate the order each run, so no case always follows another.
    const order = keys.map((_, i) => keys[(i + run) % keys.length]);
    for (const name of order) {
      const r = await render(url, name, seconds);
      times[name].push(r.ms);
      if (name === 'd') sched = r.sched;
    }
  }
  // Paired: each run's case less that run's case a, so slow drift cancels.
  const paired = (name) => times[name].map((t, i) => t - times.a[i]);
  const perParamUs = (name, params) =>
    round((median(paired(name)) * 1000) / (seconds * (RATE / 128) * PARTS * params), 3);
  return {
    userAgent: navigator.userAgent,
    runs,
    seconds,
    parts: PARTS,
    cases: Object.fromEntries(
      Object.keys(times).map((name) => [
        name,
        {
          medianMs: round(median(times[name])),
          minMs: round(Math.min(...times[name])),
          maxMs: round(Math.max(...times[name])),
          overA: name === 'a' ? null : {
            medianMs: round(median(paired(name))),
            minMs: round(Math.min(...paired(name))),
            maxMs: round(Math.max(...paired(name))),
            msPerAudioSecond: round(median(paired(name)) / seconds, 2),
          },
          runsMs: times[name].map((t) => round(t)),
        },
      ]),
    ),
    usPerParamPerQuantum: {
      b: perParamUs('b', 29),
      c: perParamUs('c', 8),
      e: perParamUs('e', 29),
      f: perParamUs('f', 8),
    },
    lastD: { calls: sched.calls, schedMs: round(sched.ms) },
  };
}

export function start(url, runs = 15, seconds = 30) {
  window.__micro = null;
  bench(url, runs, seconds).then(
    (r) => (window.__micro = r),
    (e) => (window.__micro = { error: String(e?.stack ?? e) }),
  );
  return 'started';
}
