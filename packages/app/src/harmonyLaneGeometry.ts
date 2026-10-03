/**
 * Where the harmony track's blocks draw and where its seams fall
 * (windsor#550), from the engine's `eventBounds`. A block carries its
 * event's index, never its place in the lane: when the first chord starts
 * after tick 0 the engine prepends the last chord's cyclic hold, so the
 * lane draws one more block than there are events. A seam is a boundary
 * where the event changes; the wrapped hold and the last chord's own span
 * are one chord and meet at no seam. Pure, for `songHarmonyLane.ts`.
 */
import type { EventBounds } from '@windsor/engine';
import { TICKS_PER_BAR } from '@windsor/engine';
import type { LaneGeometry, LaneSeam } from './laneEditModel';
import { blockBox, tickToPx } from './songViewTables';

/** Two adjacent drawn spans that belong to different chords: the two sides of a seam. */
export type SeamSpans = readonly [EventBounds, EventBounds];

/** Every seam's two spans, in lane order. */
export function seamSpans(spans: readonly EventBounds[]): SeamSpans[] {
  const out: SeamSpans[] = [];
  spans.forEach((left, i) => {
    const right = spans[i + 1];
    if (right && right.index !== left.index) out.push([left, right]);
  });
  return out;
}

/** The two spans either side of the seam that ends chord `index`'s block; null when it has none. */
export const seamAfter = (spans: readonly EventBounds[], index: number): SeamSpans | null =>
  seamSpans(spans).find(([left]) => left.index === index) ?? null;

/** The chord a tick falls in, by the drawn spans (the wrapped hold included); -1 outside them. */
export const chordAtTick = (spans: readonly EventBounds[], tick: number): number =>
  spans.find((s) => tick >= s.start && tick < s.end)?.index ?? -1;

/** The lane's blocks, each keyed by its event, and its seams; no block has an edge of its own. */
export function harmonyGeometry(
  spans: readonly EventBounds[],
  pxPerBar: number,
  bar: number = TICKS_PER_BAR,
): LaneGeometry {
  const width = (s: EventBounds): number => tickToPx(s.end - s.start, pxPerBar, bar);
  const seams = seamSpans(spans).map(([left, right]): LaneSeam => ({
    index: left.index,
    right: right.index,
    px: tickToPx(left.end, pxPerBar, bar),
    leftWidthPx: width(left),
    rightWidthPx: width(right),
  }));
  return {
    boxes: spans.map((s) => ({
      ...blockBox(s.start, s.end - s.start, pxPerBar, bar),
      index: s.index,
    })),
    seams,
    edges: false,
  };
}
