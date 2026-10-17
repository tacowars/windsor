/**
 * Spectre's drawn cells (record `2026-10-17-spectre-drawn-cells`): each curve
 * is `SPECTRE_CELLS` values over the log-frequency axis, each cell the same
 * share of it, one list a channel unless linked; one selection of cells spans
 * all three curves. This file is the model's arithmetic, shared by the spec,
 * the card and, for the payload's layout, the worklet:
 *
 * - **Reading:** a band at axis position x takes, by default, the value
 *   interpolated between the two nearest cell centres, the ends held past the
 *   first and last centre; with Steps on, its nearest cell's.
 *   `worklet/spectre/spectreBandMap.ts` reads every band with the same
 *   arithmetic; `inserts/spectreBands.test.ts` holds the two equal.
 * - **The payload:** what the processor is posted: each curve's left then
 *   right cells, the selection as 0/1 a cell, and each curve's Steps.
 *
 * It imports nothing but the constants, so the worklet may read it.
 */
import { SPECTRE_CELLS, SPECTRE_CELL_STEPS, SPECTRE_CURVES } from './spectreConstants';
import type { SpectreCurve } from './spectreConstants';

/** A curve's cells for one channel, `SPECTRE_CELLS` values in 0..1, low frequencies first. */
export type SpectreCells = readonly number[];

/** One curve: its left cells, its right cells when unlinked, and how bands read it. */
export interface SpectreCurveCells {
  readonly left: SpectreCells;
  /** Absent while linked: both channels read `left`. */
  readonly right?: SpectreCells;
  readonly link: boolean;
  /** Bands read their nearest cell, hard edged, instead of between the two nearest. */
  readonly steps: boolean;
}

export type SpectreCellCurves = Readonly<Record<SpectreCurve, SpectreCurveCells>>;

/** Selected cells as half-open ranges `[from, to)`, sorted, apart and inside the cells. */
export type SpectreSelection = readonly (readonly [number, number])[];

/** The payload's layout: curve c's channel ch at `(c · 2 + ch) · SPECTRE_CELLS`, then the mask, then Steps. */
export const SPECTRE_PAYLOAD_MASK = SPECTRE_CURVES.length * 2 * SPECTRE_CELLS;
export const SPECTRE_PAYLOAD_STEPS = SPECTRE_PAYLOAD_MASK + SPECTRE_CELLS;
export const SPECTRE_PAYLOAD_LENGTH = SPECTRE_PAYLOAD_STEPS + SPECTRE_CURVES.length;

/** A value held to 0..1 and stored to `SPECTRE_CELL_STEPS`, as the song keeps it. */
export const spectreCellValue = (v: number): number =>
  Number.isFinite(v)
    ? Math.round(Math.min(1, Math.max(0, v)) * SPECTRE_CELL_STEPS) / SPECTRE_CELL_STEPS
    : 0;

/** Where a cell's centre sits across it. */
const CENTRE = 0.5;

/** Cell `i`'s centre on the axis, 0..1. */
export const spectreCellCentre = (i: number): number => (i + CENTRE) / SPECTRE_CELLS;

/** The cell that axis position `x` falls in. */
export function spectreCellAt(x: number): number {
  const i = Math.floor(x * SPECTRE_CELLS);
  return i < 0 ? 0 : i >= SPECTRE_CELLS ? SPECTRE_CELLS - 1 : i;
}

/** A line from `low` at the axis's low end to `high` at its top, at the cells' centres. */
export const spectreRampCells = (low: number, high: number): number[] =>
  Array.from({ length: SPECTRE_CELLS }, (_, i) =>
    spectreCellValue(low + (high - low) * spectreCellCentre(i)),
  );

/** Every cell at `value`. */
export const spectreFlatCells = (value: number): number[] =>
  new Array<number>(SPECTRE_CELLS).fill(spectreCellValue(value));

/** How a read is moved: Steps, a shift in octaves out of the axis's `octaves`, and what each cell has added. */
export interface SpectreReadMoves {
  readonly steps: boolean;
  readonly shiftOctaves?: number;
  readonly octaves?: number;
  readonly add?: (i: number) => number;
}

/**
 * `cells` read at axis position `x`, after `shiftOctaves` (the read moves
 * that far down, so the shape moves up) out of `octaves`, with `add(i)` added
 * to each cell first, held to 0..1.
 */
export function spectreCellRead(cells: SpectreCells, x: number, moves: SpectreReadMoves): number {
  const { steps, shiftOctaves = 0, octaves = 1, add = () => 0 } = moves;
  const at = x - shiftOctaves / octaves;
  const value = (i: number): number => cells[i]! + add(i);
  let v: number;
  if (steps) v = value(spectreCellAt(at));
  else {
    const p = at * SPECTRE_CELLS - CENTRE;
    if (p <= 0) v = value(0);
    else if (p >= SPECTRE_CELLS - 1) v = value(SPECTRE_CELLS - 1);
    else {
      const i = Math.floor(p),
        t = p - i;
      v = value(i) + t * (value(i + 1) - value(i));
    }
  }
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The selection as one 0/1 a cell. */
export function spectreSelectionMask(selection: SpectreSelection): number[] {
  const mask = new Array<number>(SPECTRE_CELLS).fill(0);
  for (const [from, to] of selection) for (let i = from; i < to; i++) mask[i] = 1;
  return mask;
}

/** The 0/1 mask back as ranges, in the selection's normal form. */
export function spectreSelectionOf(mask: readonly (number | boolean)[]): [number, number][] {
  const ranges: [number, number][] = [];
  let from = -1;
  for (let i = 0; i <= SPECTRE_CELLS; i++) {
    const on = i < SPECTRE_CELLS && Boolean(mask[i]);
    if (on && from < 0) from = i;
    else if (!on && from >= 0) {
      ranges.push([from, i]);
      from = -1;
    }
  }
  return ranges;
}

/** What the payload is built from: a spec's curves and selection. */
export interface SpectreCellSource {
  readonly curves: SpectreCellCurves;
  readonly selection: SpectreSelection;
}

/** The processor's payload for `source` (see the layout above). */
export function spectreCellPayload(source: SpectreCellSource): Float32Array {
  const payload = new Float32Array(SPECTRE_PAYLOAD_LENGTH);
  SPECTRE_CURVES.forEach((curve, c) => {
    const { left, right, link, steps } = source.curves[curve];
    payload.set(left, c * 2 * SPECTRE_CELLS);
    payload.set(link || !right ? left : right, (c * 2 + 1) * SPECTRE_CELLS);
    payload[SPECTRE_PAYLOAD_STEPS + c] = steps ? 1 : 0;
  });
  payload.set(spectreSelectionMask(source.selection), SPECTRE_PAYLOAD_MASK);
  return payload;
}

/** The cells channel `channel` (0 left, 1 right) of `curve` reads. */
export const spectreChannelCells = (curve: SpectreCurveCells, channel: number): SpectreCells =>
  channel === 1 && !curve.link && curve.right ? curve.right : curve.left;
