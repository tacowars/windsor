/**
 * Where a press lands on the Roll (windsor#603 decisions 1 and 2), without
 * the DOM: a note's resize edge, the stem a press on the velocity lane
 * takes, the velocity at a height in the lane, the rows a box touches, and
 * how fast a drag at the pane's edge scrolls it.
 */
import type { RollNote } from '@windsor/engine';
import { stemPx, velocityOf } from './rollNoteLook';
import type { RollRow } from './rollRows';
import { ROLL_EDGE_SCROLL, ROLL_EDIT, ROLL_STEM } from './rollTables';

/** Whether a press `x` px into a note `width` px wide is on its right edge: its last 6 px, or a third of a short note. */
export const onResizeEdge = (x: number, width: number, table = ROLL_EDIT): boolean =>
  x > width - Math.min(table.edgePx, width * table.edgeShare);

/** Whether a pointer that moved `dx`, `dy` px since its press is still a tap. */
export const isTap = (dx: number, dy: number, table = ROLL_EDIT): boolean =>
  Math.abs(dx) <= table.tapSlopPx && Math.abs(dy) <= table.tapSlopPx;

/** The velocity lane's geometry. */
export interface LaneGeometry {
  readonly pxPerTick: number;
  /** The loop as drawn: a note past it has no stem. */
  readonly loop: number;
  readonly lanePx: number;
}

/**
 * The note whose stem a press at `x`, `y` in the lane takes: of the stems
 * within reach of `x`, the one whose top is nearest the press, so in a
 * chord, where the stems overlap, each is reached at its own height; null
 * with none in reach.
 */
export function stemAt(
  notes: readonly RollNote[],
  point: { readonly x: number; readonly y: number },
  lane: LaneGeometry,
  table = ROLL_EDIT,
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  notes.forEach((note, i) => {
    if (note.tick >= lane.loop) return;
    const dx = note.tick * lane.pxPerTick - point.x;
    if (Math.abs(dx) > table.stemReachPx) return;
    const dy = lane.lanePx - stemPx(velocityOf(note), lane.lanePx) - point.y;
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** The velocity whose stem's top is `y` px down a lane `lanePx` tall (`stemPx` inverted), unclamped. */
export const laneVelocity = (y: number, lanePx: number, stem = ROLL_STEM): number =>
  (lanePx - y) / (lanePx - stem.insetPx);

/** The pitches of the rows a box from `y0` to `y1` px touches. */
export function boxPitches(rows: readonly RollRow[], y0: number, y1: number): Set<number> {
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  return new Set(
    rows.filter((row) => row.top < bottom && row.top + row.h > top).map((r) => r.pitch),
  );
}

/**
 * The px a drag `at` px along a pane `size` px long scrolls it by this
 * frame: back near the start, on near the end, faster the deeper into the
 * edge's zone, nothing elsewhere.
 */
export function edgeScroll(at: number, size: number, table = ROLL_EDGE_SCROLL): number {
  const { zonePx, maxPx } = table;
  if (size <= 2 * zonePx) return 0;
  if (at < zonePx) return -Math.ceil((maxPx * Math.min(zonePx, zonePx - at)) / zonePx);
  if (at > size - zonePx)
    return Math.ceil((maxPx * Math.min(zonePx, at - (size - zonePx))) / zonePx);
  return 0;
}
