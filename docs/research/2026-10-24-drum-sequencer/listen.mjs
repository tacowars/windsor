/* global process, console, Buffer, URL */
/**
 * The Drum's listening renders (windsor#948, record
 * `docs/log/2026-10-24-drum-sequencer.md`): five written lines and two of
 * them varied, each driven offline by the engine's own `DrumSequencer` and
 * played on the shipped FM bundle (`fm-processor.js`), written outside the
 * repository as stereo 48 kHz 16-bit WAVs for tacowars's ear and never
 * committed.
 *
 *   node docs/research/2026-10-24-drum-sequencer/listen.mjs [--out ~/Desktop/drum-sequencer-listen]
 *
 * Each file is four bars at 128 BPM, one part alone on its shipped patch
 * with every operator's velocity sensitivity raised to 1, so a ghost note
 * and a varied velocity are heard. The part plays at velocity 0.8, so an
 * upward offset has room. Straight time, so a ratchet's hits fall at even
 * fractions of the sixteenth.
 *
 * - `tr808-kick`: hits on 0, 4, 8, 12 at 1 and on 15 at 0.45.
 * - `tr808-snare`: 4 and 12 at 1, accented; ghosts on 3 (0.3), 7 (0.25),
 *   10 (0.3) and 14 (0.35).
 * - `tr909-hat-closed`: all 16, the beats at 1, the other eighths at 0.75,
 *   the rest at 0.5; a ratchet of 2 on 7 and 11 and of 3 on 15.
 * - `tr808-tom-mid`: hits on 8–15, velocity rising from 0.5 to 1, pitch
 *   +7 +7 +5 +5 +3 +3 0 0: a roll that falls.
 * - `tr808-kick-long`: a bassline at gate 0.9, hits on 0 (0), 3 (0),
 *   6 (+3), 8 (0), 11 (+5) and 14 (+3).
 * - The snare line again at Vary 0.5, Chance 0.5, Rests sound on.
 * - The hat line again at Vary 0.5, Chance 1, Per effect on.
 *
 * It prints each file's hits per bar, `step:velocity:note` with the played
 * velocity (the part's, the hit's, any variation and the accent) and the
 * played note's name, `×n` after a ratchet's first hit, and writes the
 * same to `hits.txt` beside the WAVs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';

const ENGINE = new URL('../../../packages/engine/src/', import.meta.url);
const BARS = 4;
const BPM = 128;
const TAIL_S = 1.2;
const BLOCK = 128;
const PART_VELOCITY = 0.8;
const OUTPUT_GAIN = 0.5;
const SEED = 948;

const args = { out: join(homedir(), 'Desktop', 'drum-sequencer-listen') };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}

/** The Drum, its defaults, the FM harness and the WAV writer, bundled from their TypeScript. */
async function engineModules() {
  const { outputFiles } = buildSync({
    stdin: {
      contents: `export { DrumSequencer, DEFAULT_DRUM_CONFIG } from './sequencing/drumSequencer';
        export { DRUM_REST, drumHit } from './sequencing/drumSteps';
        export { DIVISORS, TICKS_PER_BAR, PPQ } from './sequencing/scheduler';
        export { partNoteOn } from './song/partNoteOn';
        export { PRESETS } from './patch/presets';
        export { loadProcessor, render } from './__fixtures__/workletHarness';
        export { encodeWav } from './render/wavEncoder';`,
      resolveDir: ENGINE.pathname,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'node',
    // The harness reads the bundle beside its own folder; a data URL has no base for it.
    define: { 'import.meta.url': JSON.stringify(new URL('__fixtures__/harness.ts', ENGINE).href) },
  });
  const url = `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`;
  return import(url);
}

/** Sixteen steps, `hits[i]` written at step `i` and a rest elsewhere. */
const line = (m, hits) =>
  Array.from({ length: 16 }, (_, i) => (hits[i] ? m.drumHit(hits[i]) : m.DRUM_REST));

function snare(m) {
  const ghost = (velocity) => ({ velocity });
  return line(m, {
    3: ghost(0.3),
    4: { accent: true },
    7: ghost(0.25),
    10: ghost(0.3),
    12: { accent: true },
    14: ghost(0.35),
  });
}

function hat(m) {
  const ratchets = { 7: 2, 11: 2, 15: 3 };
  const hits = {};
  for (let i = 0; i < 16; i++) {
    const velocity = i % 4 === 0 ? 1 : i % 2 === 0 ? 0.75 : 0.5;
    hits[i] = { velocity, ...(ratchets[i] && { ratchet: ratchets[i] }) };
  }
  return line(m, hits);
}

function tom(m) {
  const pitches = [7, 7, 5, 5, 3, 3, 0, 0];
  const hits = {};
  pitches.forEach((pitch, k) => {
    hits[8 + k] = { velocity: 0.5 + (0.5 * k) / 7, pitch };
  });
  return line(m, hits);
}

/** Every render: the patch, the line and the config written over the Drum's defaults. */
function renders(m) {
  const kick = line(m, { 0: {}, 4: {}, 8: {}, 12: {}, 15: { velocity: 0.45 } });
  const bass = line(m, { 0: {}, 3: {}, 6: { pitch: 3 }, 8: {}, 11: { pitch: 5 }, 14: { pitch: 3 } });
  return [
    { file: 'tr808-kick', patch: 'tr808-kick', over: { steps: kick } },
    { file: 'tr808-snare', patch: 'tr808-snare', over: { steps: snare(m) } },
    { file: 'tr909-hat-closed', patch: 'tr909-hat-closed', over: { steps: hat(m) } },
    { file: 'tr808-tom-mid', patch: 'tr808-tom-mid', over: { steps: tom(m) } },
    { file: 'tr808-kick-long', patch: 'tr808-kick-long', over: { steps: bass, gate: 0.9 } },
    {
      file: 'tr808-snare-vary-0.5-chance-0.5-rests-sound',
      patch: 'tr808-snare',
      over: { steps: snare(m), randomness: 0.5, probability: 0.5, restsSound: true },
    },
    {
      file: 'tr909-hat-closed-vary-0.5-chance-1-per-effect',
      patch: 'tr909-hat-closed',
      over: { steps: hat(m), randomness: 0.5, probability: 1, chancePerEffect: true },
    },
  ];
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** MIDI note 60 is C4. */
const noteName = (note) => `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`;

/** Four bars of the Drum: the processor's scheduled events and each bar's hits. */
function perform(m, drum, sampleRate) {
  const secondsPerTick = 60 / BPM / m.PPQ;
  const bar = m.TICKS_PER_BAR;
  const step = drum.config.divisor;
  const frame = (seconds) => Math.round(seconds * sampleRate);
  const events = [];
  const held = new Map();
  const bars = Array.from({ length: BARS }, () => []);
  let id = 0;
  for (let tick = 0; tick < BARS * bar; tick++) {
    const time = tick * secondsPerTick;
    const base = { tick, step: tick, bar: Math.floor(tick / bar), tickInBar: tick % bar };
    for (const e of drum.handleTick({ ...base, seconds: time, secondsPerTick, time })) {
      if (e.kind === 'noteOff') {
        const at = held.get(e.note);
        if (at !== undefined) events.push({ type: 'noteOff', id: at, frame: frame(e.time) });
        held.delete(e.note);
        continue;
      }
      const { velocity } = m.partNoteOn(e, PART_VELOCITY);
      const roll = e.roll;
      const hits = roll ? roll.hits : 1;
      const spacing = (step * secondsPerTick) / hits;
      for (let j = 0; j < hits; j++) {
        const on = e.time + j * spacing;
        events.push({ type: 'noteOn', id: ++id, note: e.note, velocity, frame: frame(on) });
        if (roll) events.push({ type: 'noteOff', id, frame: frame(on + roll.gate * spacing) });
        else held.set(e.note, id);
      }
      const label = `${(e.tick % bar) / step}:${velocity.toFixed(2)}:${noteName(e.note)}`;
      bars[Math.floor(e.tick / bar)].push(hits > 1 ? `${label}×${hits}` : label);
    }
  }
  const end = frame(BARS * bar * secondsPerTick);
  for (const at of held.values()) events.push({ type: 'noteOff', id: at, frame: end });
  events.sort((a, b) => a.frame - b.frame);
  return { events, bars, seconds: BARS * bar * secondsPerTick };
}

const m = await engineModules();
const dsp = m.loadProcessor();
mkdirSync(args.out, { recursive: true });
const report = [];
const list = renders(m);
for (const spec of list) {
  const source = m.PRESETS[spec.patch];
  const patch = { ...source, ops: source.ops.map((op) => ({ ...op, velSens: 1 })) };
  const config = { ...m.DEFAULT_DRUM_CONFIG, seed: SEED, ...spec.over };
  const drum = new m.DrumSequencer(config);
  const { events, bars, seconds } = perform(m, drum, dsp.sampleRate);
  const blocks = Math.ceil(((seconds + TAIL_S) * dsp.sampleRate) / BLOCK);
  const processor = dsp.create(patch, 1);
  const { samples, nonFinite } = m.render(dsp, processor, blocks, events);
  const frames = samples.length / 2;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = samples[2 * i] * OUTPUT_GAIN;
    right[i] = samples[2 * i + 1] * OUTPUT_GAIN;
  }
  const wav = m.encodeWav([left, right], dsp.sampleRate, 16);
  const file = `${spec.file}.wav`;
  writeFileSync(join(args.out, file), wav.bytes);
  const lines = [`${file} (${spec.patch}): clipped ${wav.clipped}, non-finite ${nonFinite}`];
  bars.forEach((hits, i) => lines.push(`  bar ${i + 1}: ${hits.join(' ')}`));
  report.push(...lines);
  console.log(lines.join('\n'));
}
writeFileSync(join(args.out, 'hits.txt'), `${report.join('\n')}\n`);
console.log(`wrote ${list.length} files to ${args.out}`);
