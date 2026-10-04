// What the 2× solver costs in Chrome (windsor#593, decision 5): eight held
// voices of `pad-drift` through the FM worklet in an `OfflineAudioContext`,
// the voice filter Off, Lowpass and Bandpass at 12 dB, Lowpass at 24 dB,
// Formant and Acid, on two bundles that differ only in the solver: the
// shipped one (`LADDER_OVERSAMPLE` 2, `LADDER_NEWTON_STEPS` 3) and the same
// bundle with the two constants set back to 1 and 4 (README, "The 2× solver
// in Chrome", says how it is made). The scenario is `bench.mjs`'s: `spread`
// 0, every sustain raised so dormancy never engages, the Acid variant at
// Reso 9. An offline context renders as fast as it can, so a render's wall
// time is the worklet's CPU time on the render thread; the variants are
// interleaved in rounds with their order rotated, after one warm-up round.
//
// Load it on a page served beside the two bundles and the patch, then
// `await (await import('./browserBench.js')).bench({...})`. Returns the raw
// records; `summarise` turns them into the README's table.
/* global OfflineAudioContext, AudioWorkletNode, performance, navigator, fetch, structuredClone */

const RATE = 48000;
const NOTES = [43, 48, 52, 55, 59, 62, 64, 67];
const MODES = { off: 0, lp12: 1, bp12: 3, lp24: 1, formant: 5, acid: 6 };

/** `pad-drift` in `mode`, one voice a note, every operator held at its sustain. */
function patchFor(file, mode) {
  const patch = structuredClone({ ...file.patch, spread: 0 });
  for (const op of patch.ops) op.env.sustainLevel = Math.max(op.env.sustainLevel, 0.6);
  patch.filter = { ...patch.filter, mode: MODES[mode], slope24: mode === 'lp24', vowel: 1.5 };
  if (mode === 'acid') patch.filter.resonance = 9;
  return patch;
}

/** One render of `seconds`: its wall time in ms, and the last quantum's peak (a check that the voices still sound). */
async function renderOnce(url, patch, seconds) {
  const frames = RATE * seconds;
  const context = new OfflineAudioContext(2, frames, RATE);
  await context.audioWorklet.addModule(url);
  const events = NOTES.map((note, i) => ({ type: 'noteOn', id: i + 1, note, velocity: 0.9, frame: 0 }));
  const node = new AudioWorkletNode(context, 'fm-part', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { maxVoices: NOTES.length, patch, seed: 1, events },
  });
  node.connect(context.destination);
  const started = performance.now();
  const buffer = await context.startRendering();
  const ms = performance.now() - started;
  const left = buffer.getChannelData(0);
  let peak = 0;
  for (let i = frames - 128; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]));
  return { ms, peak };
}

/** `rounds` rounds (plus one warm-up) of every bundle × mode; `bundles` maps a name to its URL. */
export async function bench({ bundles, patchUrl, rounds = 5, seconds = 10 }) {
  const file = await (await fetch(patchUrl)).json();
  const list = [];
  for (const [bundle, url] of Object.entries(bundles)) {
    for (const mode of Object.keys(MODES)) list.push({ bundle, url, mode, patch: patchFor(file, mode) });
  }
  const records = [];
  for (let round = 0; round <= rounds; round++) {
    for (let k = 0; k < list.length; k++) {
      const v = list[(k + round) % list.length];
      const { ms, peak } = await renderOnce(v.url, v.patch, seconds);
      if (round > 0) records.push({ bundle: v.bundle, mode: v.mode, round, ms, peak });
    }
  }
  return {
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    seconds,
    voices: NOTES.length,
    records,
  };
}

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2;
};

/** ns per voice-sample per bundle and mode (median over rounds), and each mode's median per-round difference from its bundle's Off. */
export function summarise({ records, seconds, voices }) {
  const ns = (ms) => (ms * 1e6) / (RATE * seconds * voices);
  const out = {};
  for (const r of records) {
    const off = records.find((o) => o.bundle === r.bundle && o.round === r.round && o.mode === 'off');
    const row = (out[`${r.bundle} ${r.mode}`] ??= { ns: [], overOff: [] });
    row.ns.push(ns(r.ms));
    row.overOff.push(ns(r.ms) - ns(off.ms));
  }
  return Object.fromEntries(
    Object.entries(out).map(([name, row]) => [
      name,
      { ns: +median(row.ns).toFixed(2), overOff: +median(row.overOff).toFixed(2), runs: row.ns.length },
    ]),
  );
}
