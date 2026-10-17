/**
 * Spectre's curve recipes (record `2026-10-17-spectre-drawn-cells` decision
 * 12): a few shapes, each `SPECTRE_CELLS` cells, written by frequency or by
 * octave so a preset reads as an idea rather than 180 numbers. The preset
 * tables build their curves from these when the module loads, and
 * `spectrePresets.test.ts` pins the cells they make.
 *
 * Every result is stored to the song's precision (`spectreCellValue`), so a
 * preset's cells survive the normaliser unchanged and the picker can match
 * them back.
 */
import { spectreCellAt, spectreCellCentre, spectreCellValue } from './spectreCells';
import type { SpectreCurveCells } from './spectreCells';
import { SPECTRE_CELLS, SPECTRE_DSP } from './spectreConstants';
import { SPECTRE_AXIS_OCTAVES, spectreAxisAt } from './spectreCurves';

export type Cells = readonly number[];

const each = (f: (i: number) => number): number[] =>
  Array.from({ length: SPECTRE_CELLS }, (_, i) => spectreCellValue(f(i)));

/** The cell `hz` falls in. */
export const cellOf = (hz: number): number => spectreCellAt(spectreAxisAt(hz));

/** The cell a span ending at `hz` stops before: past the last, at the axis's top. */
const endOf = (hz: number): number => (hz >= SPECTRE_DSP.axisHighHz ? SPECTRE_CELLS : cellOf(hz));

/** Cells per octave on the axis. */
const PER_OCTAVE = SPECTRE_CELLS / SPECTRE_AXIS_OCTAVES;

/** Every cell at `value`. */
export const flat = (value: number): number[] => each(() => value);

/** A line from `low` at the axis's foot to `high` at its top. */
export const ramp = (low: number, high: number): number[] =>
  each((i) => low + (high - low) * spectreCellCentre(i));

/** `inside` from `fromHz` up to (not including) `toHz`, `outside` elsewhere. */
export const band = (fromHz: number, toHz: number, inside: number, outside: number): number[] => {
  const from = cellOf(fromHz),
    to = endOf(toHz);
  return each((i) => (i >= from && i < to ? inside : outside));
};

/**
 * `levels` in turn across `fromHz` to `toHz`, each an even share of the
 * octaves between them; `outside` below and above.
 */
export const steps = (
  fromHz: number,
  toHz: number,
  levels: readonly number[],
  outside: number,
): number[] => {
  const from = cellOf(fromHz),
    to = endOf(toHz);
  return each((i) =>
    i < from || i >= to ? outside : levels[Math.floor(((i - from) * levels.length) / (to - from))]!,
  );
};

/**
 * A comb across the axis: `on` for `duty` of every `periodOctaves`, `off`
 * for the rest, starting `phase` of a period in.
 */
export const comb = (
  periodOctaves: number,
  on: number,
  off: number,
  duty = 0.5,
  phase = 0,
): number[] =>
  each((i) => {
    const at = i / (periodOctaves * PER_OCTAVE) + phase;
    return at - Math.floor(at) < duty ? on : off;
  });

/** The first `count` harmonics of `rootHz`, `width` cells each, at `on`; `off` between them. */
export const harmonics = (
  rootHz: number,
  count: number,
  width: number,
  on: number,
  off: number,
): number[] => {
  const marks = new Set<number>();
  for (let h = 1; h <= count; h++) {
    const centre = cellOf(rootHz * h);
    for (let w = 0; w < width; w++) marks.add(centre - Math.floor(width / 2) + w);
  }
  return each((i) => (marks.has(i) ? on : off));
};

/* eslint-disable no-magic-numbers -- an integer hash's mixing constants and its 2³² scale */
/** A seeded draw in 0..1 a call: the same run of numbers for the same seed, on every machine. */
export function spectreDraws(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return state / 0x100000000;
  };
}
/* eslint-enable no-magic-numbers */

/** A fixed draw between `low` and `high` a cell, from `seed`: the same cells every time. */
export const scatter = (seed: number, low: number, high: number): number[] => {
  const draw = spectreDraws(seed);
  return each(() => low + (high - low) * draw());
};

/** About `share` of the cells, picked from `seed`, at `on`; the rest at `off`: a sieve. */
export const sieve = (seed: number, share: number, on: number, off: number): number[] =>
  scatter(seed, 0, 1).map((draw) => spectreCellValue(draw < share ? on : off));

/** `top` where `mask` is above 0, `base` elsewhere: a shape laid into part of another. */
export const within = (mask: Cells, top: Cells, base: Cells): number[] =>
  each((i) => (mask[i]! > 0 ? top[i]! : base[i]!));

/** A gain shape moved by `db` decibels (the gain curve spans `gainRangeDb`); silent cells stay silent. */
export const trim = (gain: Cells, db: number): number[] =>
  each((i) => (gain[i]! > 0 ? gain[i]! + db / SPECTRE_DSP.gainRangeDb : 0));

/** Cell by cell, the product of two shapes. */
export const times = (a: Cells, b: Cells): number[] => each((i) => a[i]! * b[i]!);

/** A curve both channels read, smooth unless `steps`. */
export const linked = (left: Cells, stepped = false): SpectreCurveCells => ({
  left,
  link: true,
  steps: stepped,
});

/** A curve with its own right channel. */
export const unlinked = (left: Cells, right: Cells, stepped = false): SpectreCurveCells => ({
  left,
  right,
  link: false,
  steps: stepped,
});
