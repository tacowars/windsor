/**
 * The harmony track as Scale's Song chord plays it (windsor#729, record
 * `2026-10-11-bloom-follows-the-song` decision 8): each block `eventBounds`
 * draws, the last event's leading hold from tick 0 included when the first
 * event starts after it, as its start (a song tick) and its pitch set
 * (`chordPitches`). Built once per re-plan into typed arrays, so a lookup per
 * tick allocates nothing and never calls `chordAt`. A song with no chords is
 * one block from 0 on the song key's set.
 */
import { eventBounds } from '../harmony/harmonyTimeline';
import type { Harmony } from '../harmony/harmonyTimeline';
import { scaleOffsets } from '../sequencing/scaleSampler';
import { chordPitches, pitchMask } from './bloomPitches';

/** The blocks in order: `starts[i]` is block i's first song tick, `masks[i]` its pitch set. */
export interface ChordTimeline {
  readonly starts: Float64Array;
  readonly masks: Int32Array;
}

/** `harmony`'s blocks over a song of `songTicks`, as `chordAt` reads them. */
export function chordTimeline(harmony: Harmony, songTicks: number): ChordTimeline {
  const bounds = eventBounds(harmony, songTicks);
  if (bounds.length === 0) {
    const key = pitchMask(harmony.root, scaleOffsets(harmony.scale));
    return { starts: Float64Array.of(0), masks: Int32Array.of(key) };
  }
  const starts = new Float64Array(bounds.length);
  const masks = new Int32Array(bounds.length);
  bounds.forEach((block, i) => {
    starts[i] = block.start;
    masks[i] = chordPitches(harmony, harmony.events[block.index]!);
  });
  return { starts, masks };
}

/** The set of the block holding song tick `pos` (0 ≤ pos < the song's length): the last starting at or before it. */
export function chordMaskAt(timeline: ChordTimeline, pos: number): number {
  const { starts, masks } = timeline;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= pos) low = mid;
    else high = mid - 1;
  }
  return masks[low]!;
}
