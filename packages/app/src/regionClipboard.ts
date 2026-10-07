/**
 * The Song view's region clipboard (record
 * `2026-10-06-song-region-move-copy-paste`), pure: what Copy takes from a
 * region, and where Cut, Paste and Duplicate leave a part's regions. A clip
 * is the region's length and a full copy of what it plays (`patternCopy`:
 * its own pattern, or the part's sequencer for a region with none), so a
 * paste plays what was copied even after the source is edited or deleted.
 * It lands on a part of the same sequencer kind only, at a start the
 * caller picks (the playhead's bar, `pasteTick`), over anything in its way
 * (`placeRegion`). Duplicate places a copy right after the region.
 */
import type { MusicPart, PartRegion, RegionPattern, SequencerKind } from '@windsor/engine';
import { TICKS_PER_BAR } from '@windsor/engine';
import { keepsRegionPatterns, patternCopy } from './partEdits';
import type { Placement } from './regionPlacement';
import { placeRegion } from './regionPlacement';
import { deleteRegion, snapDown } from './regionModel';
import { KIND_LABELS } from './sequencerConstants';

/** A copied region: its length, the kind it plays and what it plays. */
export interface RegionClip {
  readonly kind: SequencerKind;
  readonly duration: number;
  readonly pattern?: RegionPattern;
}

type LanePart = Pick<MusicPart, 'regions' | 'sequencer'>;

/** The clip Copy takes from region `index` of `part`; null when there is no such region. */
export function copyRegion(part: LanePart, index: number): RegionClip | null {
  const region = part.regions[index];
  if (!region) return null;
  const kind = part.sequencer.kind;
  if (keepsRegionPatterns(part)) {
    return { kind, duration: region.duration, pattern: patternCopy(part, index) };
  }
  return region.pattern
    ? { kind, duration: region.duration, pattern: region.pattern }
    : { kind, duration: region.duration };
}

/** Cut: the clip, and the part's regions without the region. Null when there is no such region. */
export function cutRegion(
  part: LanePart,
  index: number,
): { clip: RegionClip; regions: PartRegion[] } | null {
  const clip = copyRegion(part, index);
  return clip ? { clip, regions: deleteRegion(part.regions, index) } : null;
}

/** The region a clip lays down at `start`. */
const fromClip = (clip: RegionClip, start: number): PartRegion =>
  clip.pattern
    ? { start, duration: clip.duration, pattern: clip.pattern }
    : { start, duration: clip.duration };

/** Why a paste was refused, in the words a toast shows. */
export interface PasteRefusal {
  readonly refused: string;
}

/** The refusal of a `kind` region anywhere but a part playing `kind`: what Paste and a drag onto another lane say. */
export function kindRefusal(kind: SequencerKind): PasteRefusal {
  const name = KIND_LABELS[kind];
  return { refused: `a ${name} region pastes only onto a ${name} part` };
}

/**
 * Paste: `clip` laid over `part`'s regions at `start`, its end cut at the
 * song's. Refused onto a part playing another kind of sequencer, or at or
 * past the end of the song.
 */
export function pasteRegion(
  part: LanePart,
  clip: RegionClip,
  start: number,
  songTicks: number,
): Placement | PasteRefusal {
  if (clip.kind !== part.sequencer.kind) return kindRefusal(clip.kind);
  return (
    placeRegion(part.regions, fromClip(clip, start), songTicks) ?? {
      refused: 'the paste starts past the end of the song',
    }
  );
}

/**
 * Duplicate: a copy of region `index` laid down right after it, over
 * anything in its way, its end cut at the song's. Null when there is no
 * such region or it already ends the song.
 */
export function duplicateRegion(
  part: LanePart,
  index: number,
  songTicks: number,
): Placement | null {
  const region = part.regions[index];
  const clip = copyRegion(part, index);
  if (!region || !clip) return null;
  return placeRegion(part.regions, fromClip(clip, region.start + region.duration), songTicks);
}

/** Where a paste lands: the playhead's bar, the position wrapped into the song. */
export function pasteTick(
  position: number,
  songTicks: number,
  bar: number = TICKS_PER_BAR,
): number {
  if (songTicks <= 0) return 0;
  const tick = ((position % songTicks) + songTicks) % songTicks;
  return snapDown(tick, bar);
}
