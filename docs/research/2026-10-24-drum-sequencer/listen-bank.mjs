/* global process, console, Buffer, URL */
/**
 * The Drum's pattern bank, rendered (windsor#950, record
 * `docs/log/2026-10-24-drum-sequencer.md`): every pattern in
 * `DRUM_PATTERNS`, applied to a new Drum part with `applyDrumPattern` as
 * the picker applies it, driven offline by the engine's own `DrumSequencer`
 * and played on the shipped FM bundle (`fm-processor.js`), written outside
 * the repository as stereo 48 kHz 16-bit WAVs for tacowars's ear and never
 * committed. The player path is `listen.mjs`'s, copied: each note-on plays
 * through `playPitched` and `rollHits`.
 *
 *   node docs/research/2026-10-24-drum-sequencer/listen-bank.mjs [--out ~/Desktop/drum-bank-listen]
 *
 * One file per pattern, `<nn>-<id>.wav` in the picker's order, two bars at
 * 128 BPM, one part alone at the Drum's defaults (middle C, gate 0.5) on
 * its group's shipped patch with every operator's velocity sensitivity
 * raised to 1, so a ghost note is heard. The part plays at velocity 0.8.
 * Straight time, so a ratchet's hits fall at even fractions of the
 * sixteenth.
 *
 * It prints each file's hits per bar, `step:velocity:note` with the step
 * numbered 1–16, the played velocity (the part's, the hit's and the
 * accent's) and the played note's name, `+m<mod>` on an accented hit,
 * `×n` after a ratchet's first hit, and writes the same to `hits.txt`
 * beside the WAVs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';

const ENGINE = new URL('../../../packages/engine/src/', import.meta.url);
const BARS = 2;
const BPM = 128;
const TAIL_S = 1.2;
const BLOCK = 128;
const PART_VELOCITY = 0.8;
const OUTPUT_GAIN = 0.5;
const SEED = 950;

/** The shipped patch each group plays, and the patterns that play another. */
const GROUP_PATCH = {
  Kick: 'tr808-kick',
  Snare: 'tr808-snare',
  Clap: 'tr808-clap',
  Hat: 'tr909-hat-closed',
  'Open hat': 'tr909-hat-open',
  Perc: 'tr808-tom-mid',
};
const PATTERN_PATCH = { 'kick-bassline': 'tr808-kick-long' };

const args = { out: join(homedir(), 'Desktop', 'drum-bank-listen') };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}

/** The Drum, its bank, the FM harness and the WAV writer, bundled from their TypeScript. */
async function engineModules() {
  const { outputFiles } = buildSync({
    stdin: {
      contents: `export { DrumSequencer, DEFAULT_DRUM_CONFIG } from './sequencing/drumSequencer';
        export { DRUM_PATTERNS, applyDrumPattern } from './sequencing/drumPatterns';
        export { TICKS_PER_BAR, PPQ } from './sequencing/scheduler';
        export { partNoteOn } from './song/partNoteOn';
        export { PLAIN_HIT, pitchedRollShape, playPitched } from './song/pitchedRoll';
        export { rollHits } from './song/rollSpan';
        export { STRAIGHT_SWING } from './sequencing/swingTables';
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

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** MIDI note 60 is C4. */
const noteName = (note) => `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`;

/**
 * A part as the processor hears it (as `listen.mjs`): `AudioPart`'s
 * `noteOn`, `trigger` and `noteOffByNote` written as the harness's
 * scheduled events, with a nonzero `mod`, `slide` and `stepMod` forwarded.
 */
function recordingPart(frame) {
  const events = [];
  const held = new Map();
  let id = 0;
  const noteOn = (note, velocity, time, extras) => {
    const message = { type: 'noteOn', id: ++id, note, velocity, frame: frame(time) };
    if (extras?.mod !== undefined && extras.mod !== 0) message.mod = extras.mod;
    if (extras?.slide) message.slide = true;
    if (extras?.stepMod) message.stepMod = extras.stepMod;
    events.push(message);
    held.set(note, [...(held.get(note) ?? []), id]);
    return id;
  };
  const release = (ids, at) => {
    for (const handle of ids) events.push({ type: 'noteOff', id: handle, frame: frame(at) });
  };
  return {
    events,
    noteOn,
    trigger(note, velocity, duration, time, extras) {
      const handle = noteOn(note, velocity, time, extras);
      const rest = held.get(note).filter((h) => h !== handle);
      if (rest.length) held.set(note, rest);
      else held.delete(note);
      release([handle], time + duration);
      return handle;
    },
    noteOffByNote(note, time) {
      release(held.get(note) ?? [], time);
      held.delete(note);
    },
    releaseAll(time) {
      for (const ids of held.values()) release(ids, time);
      held.clear();
    },
  };
}

/**
 * Two bars of the Drum (as `listen.mjs`): the processor's scheduled events
 * and each bar's hits, every note-on through the player's own
 * `playPitched` and `rollHits` over one region spanning the song.
 */
function perform(m, drum, sampleRate) {
  const secondsPerTick = 60 / BPM / m.PPQ;
  const bar = m.TICKS_PER_BAR;
  const songTicks = BARS * bar;
  const step = drum.config.divisor;
  const part = recordingPart((seconds) => Math.round(seconds * sampleRate));
  const bars = Array.from({ length: BARS }, () => []);
  for (let tick = 0; tick < songTicks; tick++) {
    const time = tick * secondsPerTick;
    const base = { tick, step: tick, bar: Math.floor(tick / bar), tickInBar: tick % bar };
    for (const e of drum.handleTick({ ...base, seconds: time, secondsPerTick, time })) {
      if (e.kind === 'noteOff') {
        part.noteOffByNote(e.note, e.time);
        continue;
      }
      const hits = e.roll
        ? m.rollHits({
            ...m.pitchedRollShape(e.roll),
            tick,
            regions: [{ start: 0, duration: songTicks }],
            songTicks,
            loop: null,
            secondsPerTick: e.roll.secondsPerTick,
            swing: m.STRAIGHT_SWING,
          })
        : m.PLAIN_HIT;
      m.playPitched(part, e, hits, PART_VELOCITY);
      const { velocity, extras } = m.partNoteOn(e, PART_VELOCITY);
      const mod = extras?.mod ? `+m${extras.mod.toFixed(2)}` : '';
      const label = `${(e.tick % bar) / step + 1}:${velocity.toFixed(2)}${mod}:${noteName(e.note)}`;
      bars[Math.floor(e.tick / bar)].push(hits.length > 1 ? `${label}×${hits.length}` : label);
    }
  }
  const seconds = songTicks * secondsPerTick;
  part.releaseAll(seconds);
  const events = part.events.sort((a, b) => a.frame - b.frame);
  return { events, bars, seconds };
}

const m = await engineModules();
const dsp = m.loadProcessor();
mkdirSync(args.out, { recursive: true });
const report = [];
m.DRUM_PATTERNS.forEach((pattern, index) => {
  const patchId = PATTERN_PATCH[pattern.id] ?? GROUP_PATCH[pattern.group];
  const source = m.PRESETS[patchId];
  const patch = { ...source, ops: source.ops.map((op) => ({ ...op, velSens: 1 })) };
  const config = m.applyDrumPattern({ ...m.DEFAULT_DRUM_CONFIG, seed: SEED }, pattern.id);
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
  const file = `${String(index + 1).padStart(2, '0')}-${pattern.id}.wav`;
  writeFileSync(join(args.out, file), wav.bytes);
  const head = `${file} "${pattern.name}" (${pattern.group}, ${patchId})`;
  const lines = [`${head}: clipped ${wav.clipped}, non-finite ${nonFinite}`];
  bars.forEach((hits, i) => lines.push(`  bar ${i + 1}: ${hits.join(' ')}`));
  report.push(...lines);
  console.log(lines.join('\n'));
});
writeFileSync(join(args.out, 'hits.txt'), `${report.join('\n')}\n`);
console.log(`wrote ${m.DRUM_PATTERNS.length} files to ${args.out}`);
