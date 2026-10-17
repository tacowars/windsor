/* global OfflineAudioContext, performance */
/**
 * What algorithm 11, Stack + One (windsor#895), costs the FM worklet against
 * algorithm 6, Stack + Two, which also sounds all four operators. Research
 * only.
 *
 * Served by the app's dev server and imported in a page
 * (`/@fs/<checkout>/docs/research/2026-10-17-twelfth-algorithm/bench.mjs`),
 * so the engine's TypeScript comes through Vite. `runBench(program,
 * algorithm)` builds eight real `AudioPart`s (the FM worklet, `FmEngine`) on
 * an `OfflineAudioContext` at 48 kHz, each holding its whole program as
 * construction events (as `render/renderSong.ts` hands in a song's opening),
 * and times `startRendering()`: the offline render runs the audio thread
 * flat out, so its wall time is the worklet's cost.
 *
 * Every part plays a library patch with its `algorithm` set to the one under
 * test, so the two runs differ in routing alone. The programs:
 *
 * - `drums`: eight drum parts at 130 BPM (two kicks on the beat, a snare and
 *   a clap on 2 and 4, two closed hats on every 16th, an open hat on the
 *   off-beats, a snare on 16ths), short decays, many note-ons;
 * - `pads`: eight `pad-drift` parts, each holding a four-note chord that
 *   changes every two bars, so every voice sounds for the whole render.
 */
import { PRESETS } from '../../../packages/engine/src/patch/presets';
import { FmEngine } from '../../../packages/engine/src/synth/fmEngine';

const SAMPLE_RATE = 48000;
const SECONDS = 16;
const BPM = 130;
const SIXTEENTH = 60 / BPM / 4;

/** Each drum part: its patch, its note, and which 16ths of a bar it plays. */
const DRUMS = [
  ['tr909-kick', 36, [0, 4, 8, 12]],
  ['tr808-kick', 35, [0, 4, 8, 12]],
  ['tr909-snare', 38, [4, 12]],
  ['tr909-clap', 39, [4, 12]],
  ['tr909-hat-closed', 42, [...Array(16).keys()]],
  ['tr808-hat-closed', 44, [...Array(16).keys()]],
  ['tr909-hat-open', 46, [2, 6, 10, 14]],
  ['efm-snare', 40, [...Array(16).keys()]],
];
const PAD_CHORDS = [
  [48, 55, 60, 63],
  [44, 51, 56, 60],
  [46, 53, 58, 62],
  [43, 50, 55, 59],
];

const frame = (seconds) => Math.round(seconds * SAMPLE_RATE);

/** Note-on and note-off messages, frame-ordered, for one note list. */
function messages(notes) {
  const out = [];
  notes.forEach(([note, start, length], id) => {
    out.push({ type: 'noteOn', id: id + 1, note, velocity: 0.9, frame: frame(start) });
    out.push({ type: 'noteOff', id: id + 1, frame: frame(start + length) });
  });
  return out.sort((a, b) => a.frame - b.frame);
}

function drumPart([, note, steps]) {
  const notes = [];
  for (let s = 0; s * SIXTEENTH < SECONDS - 0.5; s++) {
    if (steps.includes(s % 16)) notes.push([note, s * SIXTEENTH, SIXTEENTH / 2]);
  }
  return messages(notes);
}

function padPart(slot) {
  const bar = 16 * SIXTEENTH;
  const notes = [];
  for (let c = 0; c * 2 * bar < SECONDS - 0.5; c++) {
    const chord = PAD_CHORDS[(c + slot) % PAD_CHORDS.length];
    for (const note of chord) notes.push([note + 12 * (slot % 2), c * 2 * bar, 2 * bar - 0.01]);
  }
  return messages(notes);
}

/** The eight parts of a program: patch and construction events. */
function program(name) {
  if (name === 'drums') {
    return DRUMS.map((row) => ({ patch: PRESETS[row[0]], events: drumPart(row) }));
  }
  return Array.from({ length: 8 }, (_, slot) => ({
    patch: PRESETS['pad-drift'],
    events: padPart(slot),
  }));
}

/**
 * One offline render of `name` with every patch on `algorithm`: wall ms and
 * the peak heard. `sines` sets every operator's wave to Sine (wave 0), the
 * probe that separates the routing's cost from the waves it modulates.
 */
export async function runBench(name, algorithm, sines = false) {
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: SECONDS * SAMPLE_RATE,
    sampleRate: SAMPLE_RATE,
  });
  const engine = new FmEngine(context);
  await engine.init({});
  program(name).forEach(({ patch, events }, slot) => {
    const ops = sines ? patch.ops.map((op) => ({ ...op, wave: 0 })) : patch.ops;
    const played = { ...patch, algorithm, ops };
    engine.createPart(`bench${slot}`, { patch: played, events, seed: slot + 1 });
  });
  const start = performance.now();
  const buffer = await context.startRendering();
  const ms = performance.now() - start;
  let peak = 0;
  for (const s of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(s));
  return { name, algorithm, ms, msPerAudioSecond: ms / SECONDS, peak };
}

/**
 * Warm-up, then `rounds` rounds of every program on every algorithm in
 * `algorithms`, interleaved so drift lands on all alike; every run's ms per
 * second of audio.
 */
export async function runAll(rounds = 7, warmUp = 2, algorithms = [6, 11], sines = false) {
  const cases = ['drums', 'pads'].flatMap((n) => algorithms.map((a) => [n, a]));
  const runs = Object.fromEntries(cases.map(([n, a]) => [`${n} ${a}`, []]));
  for (let r = 0; r < warmUp + rounds; r++) {
    for (const [n, a] of cases) {
      const result = await runBench(n, a, sines);
      if (r >= warmUp) runs[`${n} ${a}`].push(Number(result.msPerAudioSecond.toFixed(2)));
    }
  }
  return runs;
}
