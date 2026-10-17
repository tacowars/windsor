/**
 * Spectre's Shape generators (record `2026-10-17-spectre-drawn-cells`
 * decision 10), pure: each writes a whole lane of cells from a few settings,
 * which the workbench previews as a ghost and writes within the selection on
 * Apply.
 *
 * - **The waves** (sine, triangle, square, saw up and down) run across the
 *   axis in octaves: one cycle a `period`, starting `phase` of one in, from
 *   `base` up to `base + amount`.
 * - **Random** draws each cell between the same two, from `seed`.
 * - **Harmonics** marks the first `count` harmonics of the MIDI note `root`,
 *   `width` cells each, at `base + amount`, the rest at `base`.
 * - **Key** marks every note of the song's key, in every octave, the same way.
 *
 * A note sits at the cell its frequency falls in; each cell's centre has a
 * pitch, so the ruler and the readout name notes with the same arithmetic.
 */
import {
  SPECTRE_AXIS_OCTAVES,
  SPECTRE_CELLS,
  spectreAxisAt,
  spectreAxisHz,
  spectreCellAt,
  spectreCellCentre,
  spectreCellValue,
  spectreDraws,
} from '@windsor/engine';
import type { SpectreGenerator, SpectreShapeSetting } from './spectreBenchTables';

export type SpectreShapeSettings = Readonly<Record<SpectreShapeSetting, number>>;

const SEMITONES = 12;
const A4_MIDI = 69;
const A4_HZ = 440;
/** The highest MIDI note a Key mark can reach: past the axis anyway. */
const TOP_MIDI = 140;
/** Spreads small seeds (1, 2, 3…) far apart in the draw's state. */
const SEED_SPREAD = 7919;
/** The shortest period a wave takes, in octaves, so a period of 0 can't divide by it. */
const MIN_PERIOD = 0.01;

/** The frequency of MIDI note `midi`. */
export const midiHz = (midi: number): number => A4_HZ * 2 ** ((midi - A4_MIDI) / SEMITONES);
/** The MIDI pitch (fractional) of `hz`. */
export const hzMidi = (hz: number): number => A4_MIDI + SEMITONES * Math.log2(hz / A4_HZ);
/** Cell `i`'s centre pitch, MIDI and fractional. */
export const cellMidi = (i: number): number => hzMidi(spectreAxisHz(spectreCellCentre(i)));

/** The cell MIDI note `midi` sounds in, or −1 off the axis. */
export function cellOfMidi(midi: number): number {
  const x = spectreAxisAt(midiHz(midi));
  return x <= 0 || x >= 1 ? -1 : spectreCellAt(x);
}

/* eslint-disable no-magic-numbers -- the waves' own arithmetic: the half cycle, the triangle's 4f − 1 and 3 − 4f */
/** A bipolar wave of `shape` at `t` cycles: −1..1. */
function wave(shape: SpectreGenerator, t: number): number {
  const f = t - Math.floor(t);
  switch (shape) {
    case 'sine':
      return Math.sin(2 * Math.PI * f);
    case 'triangle':
      return f < 0.5 ? 4 * f - 1 : 3 - 4 * f;
    case 'square':
      return f < 0.5 ? 1 : -1;
    case 'sawUp':
      return 2 * f - 1;
    default:
      return 1 - 2 * f;
  }
}
/* eslint-enable no-magic-numbers */

/** A seeded draw a cell in 0..1, the same for the same seed. */
function draws(seed: number): number[] {
  const draw = spectreDraws(seed * SEED_SPREAD);
  return Array.from({ length: SPECTRE_CELLS }, draw);
}

/** Cells `width` wide around each cell in `centres`, marked. */
function marks(centres: readonly number[], width: number): boolean[] {
  const out = new Array<boolean>(SPECTRE_CELLS).fill(false);
  const w = Math.max(1, Math.round(width));
  for (const c of centres) {
    if (c < 0) continue;
    for (let k = 0; k < w; k++) {
      const i = c - Math.floor((w - 1) / 2) + k;
      if (i >= 0 && i < SPECTRE_CELLS) out[i] = true;
    }
  }
  return out;
}

/** The song's key, for the Key generator: the root's pitch class and the scale's semitone offsets. */
export interface SpectreSongKey {
  readonly root: number;
  readonly offsets: readonly number[];
}

/** The cells of every note of `key`, in every octave on the axis. */
export function keyCells(key: SpectreSongKey): number[] {
  const out: number[] = [];
  for (let octave = 0; octave * SEMITONES <= TOP_MIDI; octave++) {
    for (const offset of key.offsets) out.push(cellOfMidi(octave * SEMITONES + key.root + offset));
  }
  return out;
}

/** The cells of the first `count` harmonics of MIDI note `root`. */
export const harmonicCells = (root: number, count: number): number[] =>
  Array.from({ length: Math.max(1, Math.round(count)) }, (_, h) =>
    cellOfMidi(hzMidi(midiHz(root) * (h + 1))),
  );

/** A whole lane from `shape` and its settings; `key` for the Key generator. */
export function generate(
  shape: SpectreGenerator,
  s: SpectreShapeSettings,
  key: SpectreSongKey,
): number[] {
  const top = s.base + s.amount;
  if (shape === 'random') {
    return draws(Math.round(s.seed)).map((d) => spectreCellValue(s.base + s.amount * d));
  }
  if (shape === 'harmonics' || shape === 'key') {
    const centres = shape === 'key' ? keyCells(key) : harmonicCells(s.root, s.count);
    return marks(centres, s.width).map((on) => spectreCellValue(on ? top : s.base));
  }
  const perOctave = SPECTRE_CELLS / SPECTRE_AXIS_OCTAVES;
  return Array.from({ length: SPECTRE_CELLS }, (_, i) => {
    const t = i / (Math.max(MIN_PERIOD, s.period) * perOctave) + s.phase;
    return spectreCellValue(s.base + (s.amount * (wave(shape, t) + 1)) / 2);
  });
}

/** `cells` with `shape`'s values written where `mask` is true. */
export const generatedInto = (
  cells: readonly number[],
  shape: readonly number[],
  mask: readonly boolean[],
): number[] => cells.map((v, i) => (mask[i] ? shape[i]! : v));
