/* global process, console, Buffer, URL */
/**
 * Step variation's velocity and Chance per effect listening renders
 * (windsor#945, record
 * `docs/log/2026-10-24-step-variation-velocity-and-chance.md`): the Grid
 * line and the Arp of `listen.mjs`, driven offline by the engine's own
 * `GridSequencer` and `Arpeggiator`, each note-on played through the
 * engine's `partNoteOn` (so a varied step's velocity offset lands as a part
 * plays it) on the shipped FM bundle (`fm-processor.js`), written outside
 * the repository as stereo 48 kHz 16-bit WAVs for tacowars's ear and never
 * committed.
 *
 *   node docs/research/2026-10-24-step-variation/listen-velocity.mjs [--out ~/Desktop/step-variation-velocity-listen]
 *
 * Each file is four bars at 125 BPM in C natural minor, one part alone, at
 * part velocity 0.6 and Vary 1, Rests sound and Octave off. For each part:
 * a reference with nothing varied, then Chance 0.2 and 1, each with the
 * Per effect switch off and on. That is 5 files per part, 10 in all. At
 * Chance 1 every roll passes, so off and on play the same: the pair is a
 * check, not two takes.
 *
 * - The Grid: 16 sixteenths at register 3, with rests, ties and accents.
 * - The Arp: `up` over two octaves at register 4, sixteenths, gate 0.5,
 *   over i – VI – III – VII a bar each; cell 0 accented and cell 3 a rest.
 *
 * The voice is the shipped `acid-saw` patch with every operator's velocity
 * sensitivity raised to 1, so the varied velocity is heard, at half gain.
 *
 * It prints each file's note-ons per bar, a slot per sixteenth: the note's
 * name where one strikes, `.` where none does; under each bar the played
 * velocity of each note-on in hundredths (60 is the part's 0.6; an accent
 * adds 20), and writes the same to `pitches.txt` beside the WAVs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';

const ENGINE = new URL('../../../packages/engine/src/', import.meta.url);
const BARS = 4;
const BPM = 125;
const TAIL_S = 0.6;
const BLOCK = 128;
const PART_VELOCITY = 0.6;
const OUTPUT_GAIN = 0.5;
const CHANCES = [0.2, 1];

const args = { out: join(homedir(), 'Desktop', 'step-variation-velocity-listen') };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}

/** The sequencers, their defaults, the FM harness and the WAV writer, bundled from their TypeScript. */
async function engineModules() {
  const { outputFiles } = buildSync({
    stdin: {
      contents: `export { GridSequencer, DEFAULT_GRID_CONFIG, gridNote } from './sequencing/gridSequencer';
        export { Arpeggiator } from './sequencing/arpeggiator';
        export { DEFAULT_ARP_CONFIG } from './sequencing/arpSequencer';
        export { arpNote, defaultArpSteps } from './sequencing/arpSteps';
        export { ScaleSampler } from './sequencing/scaleSampler';
        export { DIVISORS, TICKS_PER_BAR, PPQ } from './sequencing/scheduler';
        export { chordAt } from './harmony/harmonyTimeline';
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

const KEY = { root: 0, scale: 'naturalMinor' };

function gridLine(m) {
  const n = (degree, over = {}) => m.gridNote(degree, over);
  const rest = { kind: 'rest' };
  const tie = { kind: 'tie' };
  return [
    n(0, { accent: true }),
    rest,
    n(0, { octave: 1 }),
    n(2),
    n(0, { accent: true }),
    tie,
    n(4),
    rest,
    n(0, { accent: true }),
    n(6, { octave: -1 }),
    rest,
    n(3),
    n(0, { accent: true }),
    n(4),
    tie,
    n(2),
  ];
}

/** The part for one render: a sequencer with a `tick(localTick)` that hands back its note events. */
function part(m, kind, variation) {
  const sampler = new m.ScaleSampler(KEY);
  const step = m.DIVISORS.sixteenth;
  if (kind === 'grid') {
    const steps = gridLine(m);
    const config = {
      ...m.DEFAULT_GRID_CONFIG,
      steps,
      length: steps.length,
      register: { octave: 3 },
      seed: 945,
      ...variation,
    };
    const seq = new m.GridSequencer(sampler, config);
    return (tick, base) =>
      tick % step === 0 ? seq.handleTick({ ...base, step: tick / step }) : [];
  }
  const bar = m.TICKS_PER_BAR;
  const harmony = {
    ...KEY,
    events: [0, 5, 2, 6].map((degree, i) => ({ start: i * bar, duration: bar, degree, size: 3 })),
  };
  const steps = m.defaultArpSteps();
  steps[0] = m.arpNote({ accent: true });
  steps[3] = { kind: 'rest' };
  const config = {
    ...m.DEFAULT_ARP_CONFIG,
    style: 'up',
    octaves: 2,
    gate: 0.5,
    divisor: step,
    register: { octave: 4 },
    steps,
    seed: 945,
    ...variation,
  };
  const arp = new m.Arpeggiator(sampler, config);
  return (tick, base) =>
    arp.handleTick({ ...base, step: tick, chord: m.chordAt(harmony, BARS * bar, tick), regionIndex: 0 });
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** MIDI note 60 is C4. */
const noteName = (note) => `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`;

/** Four bars of the part: the processor's scheduled events, and each bar's note-on names and velocities. */
function perform(m, play, sampleRate) {
  const secondsPerTick = 60 / BPM / m.PPQ;
  const bar = m.TICKS_PER_BAR;
  const events = [];
  const held = new Map();
  const bars = Array.from({ length: BARS }, () => new Array(16).fill('.'));
  const levels = Array.from({ length: BARS }, () => new Array(16).fill('.'));
  let id = 0;
  for (let tick = 0; tick < BARS * bar; tick++) {
    const time = tick * secondsPerTick;
    const base = { tick, bar: Math.floor(tick / bar), tickInBar: tick % bar, seconds: time };
    for (const e of play(tick, { ...base, secondsPerTick, time })) {
      const frame = Math.round(e.time * sampleRate);
      if (e.kind === 'noteOff') {
        const at = held.get(e.note);
        if (at !== undefined) events.push({ type: 'noteOff', id: at, frame });
        held.delete(e.note);
        continue;
      }
      const { velocity } = m.partNoteOn(e, PART_VELOCITY);
      held.set(e.note, ++id);
      events.push({ type: 'noteOn', id, note: e.note, velocity, frame });
      const b = Math.floor(e.tick / bar);
      const slot = Math.floor((e.tick % bar) / (bar / 16));
      bars[b][slot] = noteName(e.note);
      levels[b][slot] = String(Math.round(velocity * 100));
    }
  }
  const end = Math.round(BARS * bar * secondsPerTick * sampleRate);
  for (const at of held.values()) events.push({ type: 'noteOff', id: at, frame: end });
  events.sort((a, b) => a.frame - b.frame);
  return { events, bars, levels, seconds: BARS * bar * secondsPerTick };
}

/** Every render: the reference, then each Chance by the Per effect switch. */
function renders() {
  const out = [];
  for (const kind of ['grid', 'arp']) {
    out.push({ kind, file: `${kind}-reference.wav`, variation: { randomness: 0, probability: 0 } });
    for (const probability of CHANCES) {
      for (const chancePerEffect of [false, true]) {
        const file = `${kind}-chance-${probability}-per-effect-${chancePerEffect ? 'on' : 'off'}.wav`;
        out.push({ kind, file, variation: { randomness: 1, probability, chancePerEffect } });
      }
    }
  }
  return out;
}

const m = await engineModules();
const dsp = m.loadProcessor();
const source = m.PRESETS['acid-saw'];
const patch = { ...source, ops: source.ops.map((op) => ({ ...op, velSens: 1 })) };
mkdirSync(args.out, { recursive: true });
const report = [];
const pad = (slots) => slots.map((s) => s.padEnd(4)).join(' ');
for (const spec of renders()) {
  const { events, bars, levels, seconds } = perform(m, part(m, spec.kind, spec.variation), dsp.sampleRate);
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
  writeFileSync(join(args.out, spec.file), wav.bytes);
  const lines = [`${spec.file}: clipped ${wav.clipped}, non-finite ${nonFinite}`];
  bars.forEach((slots, i) => {
    lines.push(`  bar ${i + 1}: ${pad(slots)}`);
    lines.push(`    vel: ${pad(levels[i])}`);
  });
  report.push(...lines);
  console.log(lines.join('\n'));
}
writeFileSync(join(args.out, 'pitches.txt'), `${report.join('\n')}\n`);
console.log(`wrote ${renders().length} files to ${args.out}`);
