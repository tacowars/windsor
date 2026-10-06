/**
 * Which edits a lane's tools make, by its row's scale (windsor#631): a
 * continuous lane draws, adds and moves points on its curve and bends its
 * segments (`songAutomationEdit.ts`); a switch lane (record
 * `2026-10-06-insert-switch-lanes`) paints on/off cells, adds, moves and
 * deletes steps, and never bends (`songAutomationSwitch.ts`). The gesture
 * (`songAutomationGesture.ts`) reads the pointer and asks these.
 */
import type { AutomationPoint, AutomationTargetRow } from '@windsor/engine';
import {
  addPoint,
  addPointOnLine,
  deletePoint,
  movePoint,
  strokePoints,
  strokeTo,
  type StrokePosition,
} from './songAutomationEdit';
import {
  switchAddPoint,
  switchDeletePoint,
  switchMovePoint,
  switchStrokePoints,
  switchStrokeTo,
  type StrokeGrain,
} from './songAutomationSwitch';

/** An Edit click: the tick, the value under the pointer, and whether it landed on the line. */
export interface LaneClick {
  readonly tick: number;
  readonly value: number;
  readonly onLine: boolean;
}

/** What a lane's tools write. Each returns a new list, or null for a click that changes nothing. */
export interface LaneEdits {
  /** Whether a vertical drag on the line bends its segment. */
  readonly bends: boolean;
  /** Sample a Draw stroke's move from `from` to `to` into `samples`. */
  stroke(
    samples: Map<number, number>,
    from: StrokePosition | null,
    to: StrokePosition,
    grain: StrokeGrain,
  ): void;
  /** `original` with the stroke written. */
  drawn(
    original: readonly AutomationPoint[],
    samples: ReadonlyMap<number, number>,
    grain: StrokeGrain,
  ): AutomationPoint[];
  /** `points` with an Edit click's point. */
  add(points: readonly AutomationPoint[], click: LaneClick): AutomationPoint[] | null;
  /** `points` with point `index` dragged to `to`. */
  move(
    points: readonly AutomationPoint[],
    index: number,
    to: { readonly tick: number; readonly value: number },
  ): AutomationPoint[];
  /** `points` without point `index`, as a double-click deletes it. */
  remove(points: readonly AutomationPoint[], index: number): AutomationPoint[];
}

/** A continuous lane's edits on `row`'s curve. */
const curveEdits = (row: AutomationTargetRow): LaneEdits => ({
  bends: true,
  stroke: strokeTo,
  drawn: (original, samples) => strokePoints(row, original, samples),
  add: (points, click) =>
    (click.onLine
      ? addPointOnLine(row, points, click.tick)
      : addPoint(points, click.tick, click.value)
    )?.points ?? null,
  move: movePoint,
  remove: deletePoint,
});

/** A switch lane's edits: cells, steps and no bend. */
const switchEdits = (row: AutomationTargetRow): LaneEdits => ({
  bends: false,
  stroke: switchStrokeTo,
  drawn: (original, samples, grain) => switchStrokePoints(row, original, samples, grain),
  add: (points, click) => switchAddPoint(points, click.tick, click.value),
  move: switchMovePoint,
  remove: switchDeletePoint,
});

/** The edits `row`'s lane makes. */
export const laneEdits = (row: AutomationTargetRow): LaneEdits =>
  row.scale === 'switch' ? switchEdits(row) : curveEdits(row);
