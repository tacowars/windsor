/* global console, process, URL */
/**
 * The tunables' listen. Every file plays every part's line of the audition
 * song twice in slot order, its own patch alone, with half a second between
 * parts; levels are as rendered, never normalised, so a change in level is
 * heard, and each file's RMS per part is printed.
 *
 * `--listen makeup` (the default, windsor#587): the makeup's power at 0
 * (the circuit's level, as windsor#577 shipped), 0.35, 0.5 (shipped) and
 * 0.7, `LADDER_MAKEUP_POWER-<power>.wav`; and for each power the
 * performance case, `reso-sweep-<power>.wav` (`resoSweep.mjs`): the saw on
 * an A1 figure while the Reso knob sweeps floor to top and back at a 500 Hz
 * cutoff, with its level range over 100 ms windows printed.
 *
 * `--listen tunables` (windsor#574, decision 3; windsor#577): three values
 * of each of the other sound-design tunables, the rest at their shipped
 * values, `<NAME>-<value>.wav`; then the output mix's pair for each part:
 * `<patch>-mix-on.wav` (shipped) and `<patch>-mix-off.wav`
 * (`LADDER_MIX_GAIN` 0), its line alone.
 *
 *   node renderTunables.mjs <out dir> [--listen makeup|tunables] [--song acid-audition.song.json] [--passes 2]
 *
 * The Grid line is played as `sequencing/gridSequencer.ts` plays it: a note
 * releases the held note and starts its own; a slide with a note held sends
 * its note-on (flagged `slide`) before the old note-off, and a slide to the
 * pitch held is a tie; a tie sends nothing; a rest releases. An accent adds
 * the line's `accentVelocity` to the part's velocity (to at most 1) and sends
 * its `accentMod` (`song/partNoteOn.ts`). Pitches are
 * `sequencing/scaleSampler.ts`'s: `12 (octave + 1) + root + scale[degree]`,
 * a degree past the scale carrying an octave. The processor's slide time is
 * the engine's `SLIDE_SECONDS_DEFAULT` when the patch's glide is 0, as
 * `synth/fmEngine.ts` passes it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePatch, writeWav } from '../../../../scripts/sound-match/render.mjs';
import { SR, loadVariant, renderEvents } from './bundleVariant.mjs';
import { levelRange, renderResoSweep } from './resoSweep.mjs';

const SONG = fileURLToPath(new URL('./acid-audition.song.json', import.meta.url));
/** `audioConstants.ts`'s scales the song may name, and the engine's slide time. */
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};
const SLIDE_SECONDS_DEFAULT = 0.06;
const TICKS_PER_WHOLE = 96;
const PART_GAP_S = 0.5;

/**
 * Three values of each tunable: windsor#574's three around windsor#577's
 * shipped values (16.5, 150 Hz and 0.25 in the middle), and the output
 * mix's two from the schematic's value (2.2, 160 Hz) past the fit's.
 */
export const VARIANTS = {
  LADDER_FEEDBACK_MAX: [15.5, 16.5, 17.0],
  LADDER_FEEDBACK_HP_HZ: [100, 150, 250],
  LADDER_INPUT_SCALE: [0.125, 0.25, 1],
  LADDER_MIX_GAIN: [2.2, 2.6, 3],
  LADDER_MIX_HP_HZ: [160, 400, 600],
};

/** The makeup's powers (windsor#587): the circuit's level, two either side, and the shipped 0.5. */
export const MAKEUP_POWERS = [0, 0.35, 0.5, 0.7];

function noteOf(step, register, harmony) {
  const scale = SCALES[harmony.scale];
  const carry = Math.floor(step.degree / scale.length);
  const degree = step.degree % scale.length;
  return 12 * (register + step.octave + carry + 1) + harmony.root + scale[degree];
}

/** The line's events over `passes` passes from frame 0, and the frame its last note is released. */
export function lineEvents(sequencer, { harmony, bpm, velocity, passes }) {
  const stepFrames = (SR * 60 * 4 * sequencer.divisor) / (bpm * TICKS_PER_WHOLE);
  const events = [];
  let held = null;
  let id = 0;
  const steps = sequencer.steps.slice(0, sequencer.length);
  const total = steps.length * passes;
  for (let i = 0; i < total; i++) {
    const step = steps[i % steps.length];
    const frame = Math.round(i * stepFrames);
    if (step.kind === 'tie') continue;
    const off = held && { type: 'noteOff', id: held.id, frame };
    if (step.kind === 'rest') {
      if (off) events.push(off);
      held = null;
      continue;
    }
    const note = noteOf(step, sequencer.register.octave, harmony);
    const slide = step.slide && held !== null;
    if (slide && note === held.note) continue;
    const on = { type: 'noteOn', id: ++id, note, velocity, frame };
    if (step.accent) {
      on.velocity = Math.min(1, velocity + sequencer.accentVelocity);
      on.mod = sequencer.accentMod;
    }
    if (slide) on.slide = true;
    if (slide) events.push(on);
    if (off) events.push(off);
    if (!slide) events.push(on);
    held = { id, note };
  }
  const end = Math.round(total * stepFrames);
  if (held) events.push({ type: 'noteOff', id: held.id, frame: end });
  return { events, end };
}

/** Every part's line, its own patch alone, each its own mono piece. */
export function renderParts(variant, song, passes) {
  return song.parts.map((part) => {
    const { events, end } = lineEvents(part.sequencer, {
      harmony: song.harmony,
      bpm: song.transport.bpm,
      velocity: part.velocity,
      passes,
    });
    const patch = song.patches[part.preset];
    const seconds = end / SR + PART_GAP_S;
    return renderEvents(variant, patch, events, { seconds, slideSeconds: SLIDE_SECONDS_DEFAULT });
  });
}

/** The pieces one after another. */
function concatenate(pieces) {
  const out = new Float32Array(pieces.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

/** Every part's line, its own patch alone, one after another; mono samples. */
export function renderSong(variant, song, passes) {
  return concatenate(renderParts(variant, song, passes));
}

function peakDb(samples) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return 20 * Math.log10(peak);
}

function rmsDb(samples) {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return 10 * Math.log10(sum / samples.length);
}

/** Write the song's parts one after another to `path`, and print its peak and each part's RMS. */
function writeSong(path, variant, song, passes) {
  const pieces = renderParts(variant, song, passes);
  const samples = concatenate(pieces);
  writeWav(path, samples);
  const parts = pieces.map((piece) => rmsDb(piece).toFixed(1)).join(' / ');
  console.log(`${path}  peak ${peakDb(samples).toFixed(1)} dBFS  RMS per part ${parts} dBFS`);
}

/** windsor#587's listen: the song and the Reso sweep at each makeup power. */
function makeupListen(outDir, song, passes) {
  const saw = resolvePatch('acid-saw');
  const sawPart = song.parts.find((part) => part.preset === 'acid-saw');
  for (const power of MAKEUP_POWERS) {
    const variant = loadVariant({ LADDER_MAKEUP_POWER: power });
    writeSong(join(outDir, `LADDER_MAKEUP_POWER-${power}.wav`), variant, song, passes);
    const { samples, end } = renderResoSweep(variant, saw, {
      bpm: song.transport.bpm,
      velocity: sawPart.velocity,
    });
    const path = join(outDir, `reso-sweep-${power}.wav`);
    writeWav(path, samples);
    const { range, floor, top } = levelRange(samples, end);
    console.log(
      `${path}  RMS ${rmsDb(samples.subarray(0, end)).toFixed(1)} dBFS, 100 ms windows: range ${range.toFixed(1)} dB, floor ${floor.toFixed(1)}, top ${top.toFixed(1)} dBFS`,
    );
  }
}

/** windsor#574's and windsor#577's listen: three values of each other tunable, and the mix's pairs. */
function tunablesListen(outDir, song, passes) {
  for (const [name, values] of Object.entries(VARIANTS)) {
    for (const value of values) {
      writeSong(join(outDir, `${name}-${value}.wav`), loadVariant({ [name]: value }), song, passes);
    }
  }
  const pairs = { on: loadVariant(), off: loadVariant({ LADDER_MIX_GAIN: 0 }) };
  for (const part of song.parts) {
    for (const [label, variant] of Object.entries(pairs)) {
      const path = join(outDir, `${part.preset}-mix-${label}.wav`);
      writeSong(path, variant, { ...song, parts: [part] }, passes);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at < 0 ? fallback : args.splice(at, 2)[1];
  };
  const songPath = option('song', SONG);
  const passes = Number(option('passes', 2));
  const listen = option('listen', 'makeup');
  if (args.length !== 1 || !['makeup', 'tunables'].includes(listen)) {
    console.error(
      'usage: node renderTunables.mjs <out dir> [--listen makeup|tunables] [--song path] [--passes 2]',
    );
    process.exit(2);
  }
  const song = JSON.parse(readFileSync(songPath, 'utf8'));
  if (listen === 'makeup') makeupListen(args[0], song, passes);
  else tunablesListen(args[0], song, passes);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
