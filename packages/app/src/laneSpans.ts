/**
 * Which of the Song view's lanes a pointer's height lands on (record
 * `2026-10-07-song-region-drag-across-parts` decision 1), pure. A body drag
 * keeps its pointer captured by the lane it started on, so the target is
 * read from the lanes' vertical spans, never from the event's target. A
 * pointer in the gap between two lanes counts as over the nearer one, so a
 * drag down the stack never flickers to "nowhere" between rows; above the
 * first lane or below the last it is over none.
 */

/** A lane's vertical span on screen, `top` inclusive and `bottom` exclusive, and what it names. */
export interface LaneSpan<K> {
  readonly top: number;
  readonly bottom: number;
  readonly key: K;
}

/** The key of the lane `y` falls on, or between two lanes the nearer one; null above or below them all. */
export function laneAtY<K>(spans: readonly LaneSpan<K>[], y: number): K | null {
  const sorted = spans.filter((s) => s.bottom > s.top).sort((a, b) => a.top - b.top);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || y < first.top || y >= last.bottom) return null;
  let best: LaneSpan<K> = first;
  let bestDistance = Infinity;
  for (const span of sorted) {
    if (y >= span.top && y < span.bottom) return span.key;
    const distance = y < span.top ? span.top - y : y - span.bottom;
    if (distance < bestDistance) {
      best = span;
      bestDistance = distance;
    }
  }
  return best.key;
}
