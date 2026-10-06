/**
 * A region laid over a lane the way a nonlinear timeline drops a clip
 * (record `2026-10-06-song-region-move-copy-paste`): a body drag, a
 * Cmd/Ctrl copy-drag, a paste and a duplicate all place a whole region at
 * a start of their choosing, past any neighbour, and what it lands on
 * gives way. A region it covers goes, one it overlaps is trimmed back to
 * its edge, and one it lands inside is cut in two, both pieces keeping
 * their pattern. The list stays sorted and non-overlapping inside the
 * song, the normaliser's shape (`regionNormalise.ts`), and an empty roll's
 * loop follows any length the placement changed (`fitEmptyRoll`).
 */
import type { PartRegion, Region } from '@windsor/engine';
import { TICKS_PER_BAR } from '@windsor/engine';
import { snapTick } from './regionModel';
import { fitEmptyRoll } from './rollRegionFit';

const endOf = (region: Region): number => region.start + region.duration;
const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

/** A lane after a placement: its regions, and the index the placed region holds in them. */
export interface Placement {
  readonly regions: PartRegion[];
  readonly index: number;
}

/** What is left of `region` outside `[start, end)`: nothing, one trimmed piece, or the two sides of a cut. */
function outside(region: PartRegion, start: number, end: number): PartRegion[] {
  if (endOf(region) <= start || region.start >= end) return [region];
  const pieces: PartRegion[] = [];
  if (region.start < start) pieces.push({ ...region, duration: start - region.start });
  if (endOf(region) > end) pieces.push({ ...region, start: end, duration: endOf(region) - end });
  return pieces.map((piece) => (piece.duration === region.duration ? piece : fitEmptyRoll(piece)));
}

/**
 * `placed` laid over `regions`, overwriting what it covers, its end cut at
 * the song's end. Null when it starts at or past the end of the song.
 */
export function placeRegion(
  regions: readonly PartRegion[],
  placed: PartRegion,
  songTicks: number,
): Placement | null {
  const start = Math.max(0, placed.start);
  const end = Math.min(endOf(placed), songTicks);
  if (end <= start) return null;
  const sized = { ...placed, start, duration: end - start };
  const region = sized.duration === placed.duration ? sized : fitEmptyRoll(sized);
  const kept = regions.flatMap((r) => outside(r, start, end));
  const next = [...kept, region].sort((a, b) => a.start - b.start);
  return { regions: next, index: next.indexOf(region) };
}

/** Where a body drag of `region` to `tick` lands it: snapped to `grain`, whole, inside the song. */
export const dropStart = (
  region: Region,
  tick: number,
  songTicks: number,
  grain: number = TICKS_PER_BAR,
): number => clamp(snapTick(tick, grain), 0, Math.max(0, songTicks - region.duration));

/**
 * Region `index` moved, or with `copy` copied, to start at `tick` (snapped,
 * kept whole inside the song), over anything in its way — a copy over its
 * own original too, which is trimmed like any region it lands on. A drop
 * where it started changes nothing, copy or not. Null when there is no such region.
 */
export function moveRegionOver(
  regions: readonly PartRegion[],
  index: number,
  tick: number,
  options: { readonly songTicks: number; readonly grain?: number; readonly copy?: boolean },
): Placement | null {
  const region = regions[index];
  if (!region) return null;
  const start = dropStart(region, tick, options.songTicks, options.grain);
  if (start === region.start) return { regions: [...regions], index };
  const rest = options.copy ? regions : regions.filter((_, i) => i !== index);
  return placeRegion(rest, { ...region, start }, options.songTicks);
}
