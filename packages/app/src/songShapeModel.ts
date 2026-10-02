/**
 * The Shape tool's rules (windsor#350; record `2026-10-01-song-automation-lanes`
 * decisions 12 and 13), with no DOM:
 *
 * - **The range** a press and drag select: the snapped span dragged, or the
 *   bar under a press that did not drag.
 * - **The draft**: the engine's `AutomationShapeSpec` the popover edits. Its
 *   Top starts at the lane's value at the range's start and its Bottom at the
 *   target's minimum; its shape, rate, phase and duty are the session's last.
 *   Top and Bottom are display heights (0..1 of the lane), so a slider moves
 *   evenly on the knob's own scale (dB, octaves).
 * - **Clamps**: Rate on its table, Phase on 1/16 steps, Duty within 10–90%.
 * - **The result**: the engine's `stampShape` in the lane's units, put in
 *   place by its `replaceRange`, so Apply leaves the points outside the
 *   range as they were.
 * - **The readout** and the popover's place against its lane and the view.
 */
import type {
  AutomationPoint,
  AutomationShapeKind,
  AutomationShapeSpec,
  AutomationTargetRow,
} from '@windsor/engine';
import { TICKS_PER_BAR, replaceRange, stampShape, toDisplay, valueAt } from '@windsor/engine';
import {
  ONCE_SHAPES,
  SHAPE_CHOICES,
  SHAPE_LIMITS,
  SHAPE_POPOVER,
  SHAPE_RATES,
  SHAPE_READOUT_DECIMALS,
  type ShapeLimits,
  type ShapePopoverGeometry,
  type ShapeRate,
  type ShapeSettings,
} from './songShapeTables';
import { formatPosition } from './transportModel';

/** A selected range of song ticks, `startTick < endTick`. */
export interface ShapeRange {
  readonly startTick: number;
  readonly endTick: number;
}

/** A press and its drag under the Shape tool, in song ticks. */
export interface ShapeDrag {
  /** Where the press landed, unsnapped: the bar under it is a click's range. */
  readonly pressTick: number;
  /** The press and the pointer now, both snapped. */
  readonly fromTick: number;
  readonly toTick: number;
  /** Whether the pointer moved past the drag threshold. */
  readonly dragged: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The bar under `tick`, inside a song of `songTicks`. */
export function barAt(tick: number, songTicks: number, barTicks = TICKS_PER_BAR): ShapeRange {
  const bar = Math.min(barTicks, songTicks);
  const start = clamp(Math.floor(tick / barTicks) * barTicks, 0, songTicks - bar);
  return { startTick: start, endTick: start + bar };
}

/** The range a drag selects (decision 1): the span dragged, or one bar for a press that did not drag. */
export function shapeRange(
  drag: ShapeDrag,
  songTicks: number,
  barTicks = TICKS_PER_BAR,
): ShapeRange {
  const startTick = Math.min(drag.fromTick, drag.toTick);
  const endTick = Math.max(drag.fromTick, drag.toTick);
  if (drag.dragged && endTick > startTick) return { startTick, endTick };
  return barAt(drag.pressTick, songTicks, barTicks);
}

/** Whether `kind` repeats at the rate; Ramp and S-curve span the range once. */
export const isCyclic = (kind: AutomationShapeKind): boolean => !ONCE_SHAPES.has(kind);

/** Which sliders `kind` reads (decision 3): Rate and Phase for a cyclic shape, Duty for the square. */
export const shapeControls = (
  kind: AutomationShapeKind,
): { readonly rate: boolean; readonly phase: boolean; readonly duty: boolean } => ({
  rate: isCyclic(kind),
  phase: isCyclic(kind),
  duty: kind === 'square',
});

/** The Rate stop nearest `ticks`. */
export function rateIndex(ticks: number, rates: readonly ShapeRate[] = SHAPE_RATES): number {
  let best = 0;
  rates.forEach((rate, i) => {
    if (Math.abs(rate.ticks - ticks) < Math.abs(rates[best]!.ticks - ticks)) best = i;
  });
  return best;
}

/** `draft` with every setting inside its range and on its step. */
export function clampDraft(
  draft: AutomationShapeSpec,
  limits: ShapeLimits = SHAPE_LIMITS,
  rates: readonly ShapeRate[] = SHAPE_RATES,
): AutomationShapeSpec {
  const steps = limits.phaseSteps;
  return {
    kind: draft.kind,
    rateTicks: rates[rateIndex(draft.rateTicks, rates)]!.ticks,
    top: clamp(draft.top, 0, 1),
    bottom: clamp(draft.bottom, 0, 1),
    phase: clamp(Math.round(draft.phase * steps) / steps, 0, 1),
    duty: clamp(draft.duty, limits.dutyMin, limits.dutyMax),
  };
}

/**
 * The draft a new range opens with (decision 4): the session's shape, rate,
 * phase and duty, Top at the lane's value at the range's start, Bottom at
 * the target's minimum.
 */
export function shapeDraft(
  row: AutomationTargetRow,
  points: readonly AutomationPoint[],
  range: ShapeRange,
  settings: ShapeSettings,
): AutomationShapeSpec {
  const top = points.length > 0 ? toDisplay(row, valueAt(row, points, range.startTick)) : 1;
  return clampDraft({ ...settings, top, bottom: 0 });
}

/** What the session keeps of a draft: everything but Top and Bottom, which belong to the lane. */
export const settingsOf = (draft: AutomationShapeSpec): ShapeSettings => ({
  kind: draft.kind,
  rateTicks: draft.rateTicks,
  phase: draft.phase,
  duty: draft.duty,
});

/** The points the draft stamps over the range, in the lane's units. */
export const stampedPoints = (
  row: AutomationTargetRow,
  range: ShapeRange,
  draft: AutomationShapeSpec,
): AutomationPoint[] => stampShape(draft, range.startTick, range.endTick, row);

/** The lane's points with the range replaced by the stamp: the preview, and what Apply commits. */
export const shapedPoints = (
  points: readonly AutomationPoint[],
  range: ShapeRange,
  stamp: readonly AutomationPoint[],
): AutomationPoint[] => replaceRange(points, range.startTick, range.endTick, stamp);

/** How many cycles the draft draws over the range: one for Ramp and S-curve. */
export const cycleCount = (range: ShapeRange, draft: AutomationShapeSpec): number =>
  isCyclic(draft.kind) ? (range.endTick - range.startTick) / draft.rateTicks : 1;

const amount = (n: number, one: string, many: string): string => {
  const shown = Number(n.toFixed(SHAPE_READOUT_DECIMALS));
  return `${shown} ${shown === 1 ? one : many}`;
};

/** The readout (decision 3): the range, its length in bars, the cycles and the points stamped. */
export function shapeReadout(
  range: ShapeRange,
  draft: AutomationShapeSpec,
  pointCount: number,
  barTicks = TICKS_PER_BAR,
): string {
  const from = formatPosition(range.startTick, 0);
  const to = formatPosition(range.endTick, 0);
  const bars = amount((range.endTick - range.startTick) / barTicks, 'bar', 'bars');
  const cycles = amount(cycleCount(range, draft), 'cycle', 'cycles');
  return `${from} → ${to} · ${bars} · ${cycles} · ${amount(pointCount, 'point', 'points')}`;
}

/** Phase as the popover prints it, in degrees. */
export const phaseLabel = (phase: number, limits: ShapeLimits = SHAPE_LIMITS): string =>
  `${Math.round(phase * limits.degreesPerCycle)}°`;

/** Duty as the popover prints it, in percent. */
export const dutyLabel = (duty: number, limits: ShapeLimits = SHAPE_LIMITS): string =>
  `${Math.round(duty * limits.percent)}%`;

/** A shape's label on its button and in the undo step. */
export const shapeLabel = (kind: AutomationShapeKind): string =>
  SHAPE_CHOICES.find((c) => c.kind === kind)?.label ?? kind;

/** Where the popover may go and how big it is, in viewport px. */
export interface PopoverFrame {
  /** The range's start, and the lane's top and bottom edges. */
  readonly anchorX: number;
  readonly laneTop: number;
  readonly laneBottom: number;
  /** The Song view's visible left and right edges. */
  readonly viewLeft: number;
  readonly viewRight: number;
  readonly viewportHeight: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The popover's top-left (decision 2): below the lane at the range's start,
 * kept inside the view's edges. Where it would run off the bottom of the
 * window and there is room above the lane, it sits above it instead.
 */
export function popoverPlacement(
  frame: PopoverFrame,
  geometry: ShapePopoverGeometry = SHAPE_POPOVER,
): { readonly left: number; readonly top: number } {
  const { gapPx, marginPx } = geometry;
  const lo = frame.viewLeft + marginPx;
  const hi = Math.max(lo, frame.viewRight - frame.width - marginPx);
  const below = frame.laneBottom + gapPx;
  const above = frame.laneTop - gapPx - frame.height;
  const fitsBelow = below + frame.height <= frame.viewportHeight - marginPx;
  return {
    left: clamp(frame.anchorX, lo, hi),
    top: fitsBelow || above < marginPx ? below : above,
  };
}
