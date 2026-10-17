/**
 * Spectre's cell edits (record `2026-10-17-spectre-drawn-cells` decision 10),
 * pure: what each brush stroke, transform and selection gesture does to a
 * spec. A brush works on one curve's cells for the channel being edited (both,
 * while the curve is linked); a transform acts on the selected cells, or on
 * every cell when nothing is selected. Every value written is stored to the
 * song's precision (`spectreCellValue`), so what the workbench commits is
 * what the normaliser keeps. `spectreCellEdits.test.ts` pins each one.
 */
import {
  SPECTRE_CELLS,
  SPECTRE_REST,
  spectreCellValue,
  spectreChannelCells,
  spectreSelectionMask,
  spectreSelectionOf,
} from '@windsor/engine';
import type { SpectreCells, SpectreCurve, SpectreCurveCells, SpectreSpec } from '@windsor/engine';

/** Which channel the workbench edits: 0 the left, 1 the right (both, while a curve is linked). */
export type SpectreChannel = 0 | 1;

const clampCell = (i: number): number => Math.min(SPECTRE_CELLS - 1, Math.max(0, Math.round(i)));

/** The cells `channel` edits of `curve`. */
export const editedCells = (
  spec: SpectreSpec,
  curve: SpectreCurve,
  channel: SpectreChannel,
): SpectreCells => spectreChannelCells(spec.curves[curve], channel);

/** `spec` with `cells` written to `curve` for `channel`: to both while linked, else to that side. */
export function withCells(
  spec: SpectreSpec,
  curve: SpectreCurve,
  channel: SpectreChannel,
  cells: readonly number[],
): SpectreSpec {
  const now = spec.curves[curve];
  const stored = cells.map(spectreCellValue);
  const next: SpectreCurveCells = now.link
    ? { ...now, left: stored }
    : channel === 0
      ? { ...now, left: stored }
      : { ...now, right: stored };
  return { ...spec, curves: { ...spec.curves, [curve]: next } };
}

/** `spec` with one curve's Link or Steps set; unlinking starts the right from the left. */
export function withCurveSwitch(
  spec: SpectreSpec,
  curve: SpectreCurve,
  key: 'link' | 'steps',
  on: boolean,
): SpectreSpec {
  const now = spec.curves[curve];
  let next: SpectreCurveCells = { ...now, [key]: on };
  if (key === 'link') {
    next = on
      ? { left: now.left, link: true, steps: now.steps }
      : { ...now, right: now.left, link: false };
  }
  return { ...spec, curves: { ...spec.curves, [curve]: next } };
}

/** `value` on `levels` even steps of 0..1 (2 is off/on); 0 levels leaves it. */
export function levelled(value: number, levels: number): number {
  if (levels < 2) return value;
  return Math.round(value * (levels - 1)) / (levels - 1);
}

/** `value` on multiples of `step` (a share of full scale); a step of 0 or less leaves it. */
export const snappedTo = (value: number, step: number): number =>
  step > 0 ? Math.min(1, Math.round(value / step) * step) : value;

/** The cells a brush `width` wide covers around `centre`, as [first, last]. */
export function brushSpan(centre: number, width: number): [number, number] {
  const half = (Math.max(1, Math.round(width)) - 1) / 2;
  return [clampCell(centre - Math.floor(half)), clampCell(centre + Math.ceil(half))];
}

/** One brush position: the cell it is over and the value its height reads. */
export interface BrushAt {
  readonly cell: number;
  readonly value: number;
}

/**
 * A Draw stroke from `from` to `to`: every cell the brush passes takes the
 * value along the straight line between them, so a fast drag leaves no gaps
 * and Shift's line is the same call from the press.
 */
export function drawStroke(
  cells: SpectreCells,
  from: BrushAt,
  to: BrushAt,
  width: number,
): number[] {
  const out = [...cells];
  const steps = Math.max(1, Math.abs(to.cell - from.cell));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const centre = from.cell + t * (to.cell - from.cell);
    const value = from.value + t * (to.value - from.value);
    const [a, b] = brushSpan(centre, width);
    for (let i = a; i <= b; i++) out[i] = value;
  }
  return out;
}

/* eslint-disable no-magic-numbers -- the brushes' kernels: a raised cosine's halves, and three- and four-tap averages */
/** A raised-cosine weight across the brush: 1 at its centre, 0 just past its edges. */
function weight(i: number, centre: number, width: number): number {
  const half = Math.max(1, width) / 2 + 0.5;
  const d = Math.abs(i - centre) / half;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
}

/** Push: `amount` (a share of full scale) added under the brush, softly toward its edges. */
export function pushAt(
  cells: SpectreCells,
  centre: number,
  width: number,
  amount: number,
): number[] {
  return cells.map((v, i) => v + amount * weight(i, centre, width));
}

/** Smooth: each cell under the brush pulled toward its neighbours' average by `strength`. */
export function smoothAt(
  cells: SpectreCells,
  centre: number,
  width: number,
  strength: number,
): number[] {
  return cells.map((v, i) => {
    const w = weight(i, centre, width) * strength;
    if (w === 0) return v;
    const left = cells[Math.max(0, i - 1)]!,
      right = cells[Math.min(SPECTRE_CELLS - 1, i + 1)]!;
    return v + w * ((left + v + right) / 3 - v);
  });
}

/** Erase: the cells under the brush back at the curve's rest. */
export function eraseAt(
  cells: SpectreCells,
  curve: SpectreCurve,
  centre: number,
  width: number,
): number[] {
  const [a, b] = brushSpan(centre, width);
  return cells.map((v, i) => (i >= a && i <= b ? SPECTRE_REST[curve] : v));
}

/** The cells a transform acts on: the selection, or all of them when nothing is selected. */
export function transformMask(spec: SpectreSpec): boolean[] {
  const mask = spectreSelectionMask(spec.selection);
  const any = mask.some((v) => v !== 0);
  return mask.map((v) => !any || v !== 0);
}

/** `f` applied to the masked cells only. */
const onMask = (
  cells: SpectreCells,
  mask: readonly boolean[],
  f: (v: number, i: number) => number,
): number[] => cells.map((v, i) => (mask[i] ? f(v, i) : v));

/** Smooth the masked cells: three passes of a neighbour average. */
export function smoothCells(cells: SpectreCells, mask: readonly boolean[]): number[] {
  let out = [...cells];
  for (let pass = 0; pass < 3; pass++) {
    const was = out;
    out = onMask(was, mask, (v, i) => {
      const left = was[Math.max(0, i - 1)]!,
        right = was[Math.min(SPECTRE_CELLS - 1, i + 1)]!;
      return (left + 2 * v + right) / 4;
    });
  }
  return out;
}

/* eslint-enable no-magic-numbers */

/** Quantize the masked cells onto multiples of `step`. */
export const quantizeCells = (
  cells: SpectreCells,
  mask: readonly boolean[],
  step: number,
): number[] => onMask(cells, mask, (v) => snappedTo(v, step));

/** Turn the masked cells' values upside down. */
export const invertCells = (cells: SpectreCells, mask: readonly boolean[]): number[] =>
  onMask(cells, mask, (v) => 1 - v);

/** Put the masked cells back at the curve's rest. */
export const resetCells = (
  cells: SpectreCells,
  mask: readonly boolean[],
  curve: SpectreCurve,
): number[] => onMask(cells, mask, () => SPECTRE_REST[curve]);

/** Mirror the masked cells along the axis, within the span from the first masked cell to the last. */
export function flipCells(cells: SpectreCells, mask: readonly boolean[]): number[] {
  const first = mask.indexOf(true),
    last = mask.lastIndexOf(true);
  if (first < 0) return [...cells];
  return onMask(cells, mask, (v, i) => {
    const from = first + last - i;
    return mask[from] ? cells[from]! : v;
  });
}

/**
 * Move the masked cells' values one cell up (`by` 1) or down (−1) within the
 * mask: a cell reads only a masked neighbour, so the vacated edge keeps its value.
 */
export const nudgeCells = (cells: SpectreCells, mask: readonly boolean[], by: 1 | -1): number[] =>
  onMask(cells, mask, (v, i) => {
    const from = clampCell(i - by);
    return mask[from] ? cells[from]! : v;
  });

/** A selection gesture over cells `from`..`to` (either order): replace, add to, or take from what is selected. */
export function selectCells(
  spec: SpectreSpec,
  from: number,
  to: number,
  mode: 'replace' | 'add' | 'remove',
): SpectreSpec {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const mask =
    mode === 'replace'
      ? new Array<number>(SPECTRE_CELLS).fill(0)
      : spectreSelectionMask(spec.selection);
  for (let i = clampCell(a); i <= clampCell(b); i++) mask[i] = mode === 'remove' ? 0 : 1;
  return { ...spec, selection: spectreSelectionOf(mask) };
}
