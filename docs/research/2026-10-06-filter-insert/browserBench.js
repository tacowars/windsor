// What the Filter insert costs in Chrome (windsor#622 decision 8): one
// `filter-insert` node on a stereo part with steady input, in each mode,
// beside one Acid voice for reference. The input is a looping second of
// stereo white noise peaking at -6 dBFS from an `AudioBufferSourceNode`, so the
// filter never rests; "source" is the same graph with no filter, which every
// other variant is read over. "Off" is the insert switched off (the copy).
// The reference is one held `pad-drift` voice through the FM worklet,
// `spread` 0 and its sustain raised so dormancy never engages, with the voice
// filter Off and Acid at the bench's Reso. An offline context renders as fast
// as it can, so a render's wall time is the worklets' CPU time on the render
// thread; the variants are interleaved in rounds with their order rotated,
// after one warm-up round (the method of
// `docs/research/2026-10-04-acid-ladder-filter/browserBench.js`).
//
// Load it on a page that can reach the two generated bundles and the patch,
// then `await (await import('./browserBench.js')).bench({...})`. Returns the
// raw records; `summarise` turns them into the README's table.
/* global OfflineAudioContext, AudioWorkletNode, performance, navigator, fetch, structuredClone */

const RATE = 48000;
const CUTOFF = 1200;
const RESO = 4;
/** The insert's `mode` param is an index into FILTER_MODES: lowpass 0 … acid 4. */
const INSERT = {
  source: null,
  off: { mode: 0, slope24: 0, enabled: 0 },
  lp12: { mode: 0, slope24: 0 },
  lp24: { mode: 0, slope24: 1 },
  hp12: { mode: 1, slope24: 0 },
  bp12: { mode: 2, slope24: 0 },
  notch12: { mode: 3, slope24: 0 },
  acid: { mode: 4, slope24: 0 },
};
/** The voice filter's ids (`modeIds.ts`): Off 0, Acid 6. */
const VOICE = { voiceOff: 0, voiceAcid: 6 };

function noise(context) {
  const buffer = context.createBuffer(2, RATE, RATE);
  let state = 0x5eed;
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < RATE; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      data[i] = ((state >>> 0) / 0x100000000 - 0.5);
    }
  }
  return buffer;
}

/** One insert render of `seconds`: its wall time in ms and the last quantum's peak. */
async function renderInsert(url, variant, seconds) {
  const frames = RATE * seconds;
  const context = new OfflineAudioContext(2, frames, RATE);
  await context.audioWorklet.addModule(url);
  const source = context.createBufferSource();
  source.buffer = noise(context);
  source.loop = true;
  const settings = INSERT[variant];
  if (settings) {
    const node = new AudioWorkletNode(context, 'filter-insert', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      parameterData: { cutoff: CUTOFF, resonance: RESO, mix: 1, enabled: 1, ...settings },
    });
    source.connect(node).connect(context.destination);
  } else source.connect(context.destination);
  source.start();
  return timed(context, frames);
}

/** One FM render of `seconds`: one held voice of `patch`. */
async function renderVoice(url, patch, seconds) {
  const frames = RATE * seconds;
  const context = new OfflineAudioContext(2, frames, RATE);
  await context.audioWorklet.addModule(url);
  const node = new AudioWorkletNode(context, 'fm-part', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      maxVoices: 1,
      patch,
      seed: 1,
      events: [{ type: 'noteOn', id: 1, note: 48, velocity: 0.9, frame: 0 }],
    },
  });
  node.connect(context.destination);
  return timed(context, frames);
}

async function timed(context, frames) {
  const started = performance.now();
  const buffer = await context.startRendering();
  const ms = performance.now() - started;
  const left = buffer.getChannelData(0);
  let peak = 0;
  for (let i = frames - 128; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]));
  return { ms, peak };
}

function voicePatch(file, mode) {
  const patch = structuredClone({ ...file.patch, spread: 0 });
  for (const op of patch.ops) op.env.sustainLevel = Math.max(op.env.sustainLevel, 0.6);
  patch.filter = { ...patch.filter, mode, slope24: false, cutoff: CUTOFF, resonance: RESO };
  return patch;
}

/** `rounds` rounds (plus one warm-up) of every variant; the URLs are the two bundles and the patch. */
export async function bench({ filterUrl, fmUrl, patchUrl, rounds = 7, seconds = 10 }) {
  const file = await (await fetch(patchUrl)).json();
  const list = [
    ...Object.keys(INSERT).map((variant) => ({
      variant,
      run: () => renderInsert(filterUrl, variant, seconds),
    })),
    ...Object.entries(VOICE).map(([variant, mode]) => ({
      variant,
      run: () => renderVoice(fmUrl, voicePatch(file, mode), seconds),
    })),
  ];
  const records = [];
  for (let round = 0; round <= rounds; round++) {
    for (let k = 0; k < list.length; k++) {
      const v = list[(k + round) % list.length];
      const { ms, peak } = await v.run();
      if (round > 0) records.push({ variant: v.variant, round, ms, peak });
    }
  }
  return {
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    seconds,
    cutoff: CUTOFF,
    resonance: RESO,
    records,
  };
}

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2;
};

/**
 * ns per stereo frame (median over rounds, with the range), and each
 * variant's median per-round difference over its baseline: an insert over
 * "source", the Acid voice over the Off voice.
 */
export function summarise({ records, seconds }) {
  const ns = (ms) => (ms * 1e6) / (RATE * seconds);
  const out = {};
  for (const r of records) {
    const base = r.variant.startsWith('voice') ? 'voiceOff' : 'source';
    const b = records.find((o) => o.round === r.round && o.variant === base);
    const row = (out[r.variant] ??= { ns: [], over: [] });
    row.ns.push(ns(r.ms));
    row.over.push(ns(r.ms) - ns(b.ms));
  }
  return Object.fromEntries(
    Object.entries(out).map(([name, row]) => [
      name,
      {
        ns: +median(row.ns).toFixed(2),
        min: +Math.min(...row.ns).toFixed(2),
        max: +Math.max(...row.ns).toFixed(2),
        over: +median(row.over).toFixed(2),
        runs: row.ns.length,
      },
    ]),
  );
}
