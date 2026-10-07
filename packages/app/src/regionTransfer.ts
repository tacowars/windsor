/**
 * A region dragged onto another part's lane (record
 * `2026-10-07-song-region-drag-across-parts`), pure: the drop is a Copy of
 * the region (`copyRegion`) pasted onto the target part at the drag's
 * snapped start (`pasteRegion`), so it plays exactly what copy and paste
 * would, lands only on a part of the same sequencer kind, and overwrites
 * what it lands on (`placeRegion`). A move also takes the region out of its
 * source part; a copy leaves the source as it was. Both parts' regions come
 * back together, for one commit and one undo. The drop is read from each
 * pointer event as it comes, the release's included (`regionDropAt`): what
 * a release commits is where the pointer and Shift and Cmd/Ctrl are at
 * pointer-up, never what the last move left.
 */
import type { MusicPart, PartRegion } from '@windsor/engine';
import type { PasteRefusal } from './regionClipboard';
import { regionGrain } from './partEdits';
import { copyRegion, pasteRegion } from './regionClipboard';
import { deleteRegion } from './regionModel';
import { dropStart } from './regionPlacement';

type LanePart = Pick<MusicPart, 'regions' | 'sequencer'>;

/** Where and how a drag drops region `index` of its source part. */
export interface RegionDrop {
  readonly index: number;
  /** The start the pointer's travel gives the region, before it is snapped and kept whole (`dropStart`). */
  readonly tick: number;
  /** Cmd/Ctrl held: copy, leaving the source alone. */
  readonly copy: boolean;
  readonly songTicks: number;
  /** The dragged region's own grain: the bar, or with Shift its step (`regionGrain`). */
  readonly grain: number;
}

/** The keys a drag reads, as one pointer event carries them. */
export interface DragKeys {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/** What the keys ask of a drag at this event: Shift the finer grain, Cmd or Ctrl a copy. */
export const dragModifiers = (keys: DragKeys): { fine: boolean; copy: boolean } => ({
  fine: keys.shiftKey,
  copy: keys.ctrlKey || keys.metaKey,
});

/** A body press: the region it grabbed and the tick it landed on. */
export interface BodyPress {
  readonly index: number;
  readonly pressTick: number;
}

/** Where a drag's pointer is at one event: its tick, and what that event's keys ask (`dragModifiers`). */
export interface DropPointer {
  readonly tick: number;
  readonly fine: boolean;
  readonly copy: boolean;
}

/**
 * The drop a body press makes with the pointer at `pointer`: the region's
 * start moved by the pointer's travel, Cmd/Ctrl's copy, and the region's
 * own grain (Shift: its step). Null when there is no such region.
 */
export function regionDropAt(
  source: LanePart,
  press: BodyPress,
  pointer: DropPointer,
  song: { readonly songTicks: number; readonly bar: number },
): RegionDrop | null {
  const region = source.regions[press.index];
  if (!region) return null;
  return {
    index: press.index,
    tick: region.start + pointer.tick - press.pressTick,
    copy: pointer.copy,
    songTicks: song.songTicks,
    grain: regionGrain(source, press.index, pointer.fine, song.bar),
  };
}

/** Both lanes after a drop: the source's regions, the target's, and the index the dropped region holds in the target. */
export interface Transfer {
  readonly source: PartRegion[];
  readonly target: PartRegion[];
  readonly index: number;
}

/**
 * Region `drop.index` of `source` dropped onto `target`, another part: the
 * target's regions with the region pasted at the snapped start, and the
 * source's without it (or unchanged for a copy). Refused, in Paste's words,
 * onto a part of another kind. Null when there is no such region.
 */
export function transferRegion(
  source: LanePart,
  target: LanePart,
  drop: RegionDrop,
): Transfer | PasteRefusal | null {
  const region = source.regions[drop.index];
  const clip = copyRegion(source, drop.index);
  if (!region || !clip) return null;
  const start = dropStart(region, drop.tick, drop.songTicks, drop.grain);
  const placed = pasteRegion(target, clip, start, drop.songTicks);
  if ('refused' in placed) return placed;
  return {
    source: drop.copy ? [...source.regions] : deleteRegion(source.regions, drop.index),
    target: placed.regions,
    index: placed.index,
  };
}
