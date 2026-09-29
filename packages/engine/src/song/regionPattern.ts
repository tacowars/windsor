/**
 * The one read of what a region plays (windsor#73, epic windsor#70; record
 * `2026-09-29-each-region-plays-its-own-pattern`). A region may carry its
 * own `pattern`, the part's `SequencerSpec` without the seed; one without
 * plays the part's `sequencer`. The player and the console both read a
 * region's pattern through `regionPattern`, so the fallback and the seed
 * rule live here and nowhere else.
 */
import type { MusicPart, SequencerSpec } from './arrangement';

/**
 * The spec region `regionIndex` of `part` plays: its own pattern with the
 * part's `seed` (for a seeded kind), or `part.sequencer` when the region has
 * no pattern or the index names no region. A pattern of another kind than
 * the part's (a live edit that changed the kind and left the regions
 * behind) is not played either: the part's kind wins, as the normaliser's
 * rule says.
 */
export function regionPattern(
  part: Pick<MusicPart, 'regions' | 'sequencer'>,
  regionIndex: number,
): SequencerSpec {
  const { sequencer } = part;
  const pattern = part.regions[regionIndex]?.pattern;
  if (pattern === undefined || pattern.kind !== sequencer.kind) return sequencer;
  // The kinds match, so the pattern is the part's spec less the seed.
  const spec = 'seed' in sequencer ? { ...pattern, seed: sequencer.seed } : pattern;
  return spec as SequencerSpec;
}
