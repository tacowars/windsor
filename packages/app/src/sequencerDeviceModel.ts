/**
 * What the sequencer device's rail says and allows (windsor#368, record
 * `2026-10-01-sequencer-rack-devices` decision 2), without the DOM: the
 * region as `n/m`, whether Split and Delete can act, and which devices are
 * folded to their rail. Split and Delete act on the selected region exactly
 * as the pane's buttons did before the rail held them: Split needs a region
 * of two bars or more, and neither acts with no region selected.
 *
 * Split and Delete read the part from the document at the press, never from
 * the pane's paint: a card's edit never redraws the pane, so the part the
 * pane drew lacks every step programmed since, and a split cut from it gave
 * both halves the stale pattern (windsor#368 fix round 1).
 */
import type { ArrangementDocument, PartRegion } from '@windsor/engine';
import { TICKS_PER_BAR, partAt, ticksPerBar } from '@windsor/engine';
import { splitPartRegion } from './partEdits';
import { deleteRegion } from './regionModel';

/** The rail's region label and its tooltip. */
export interface RegionBadge {
  readonly text: string;
  readonly title: string;
}

/**
 * The region the device edits, as `n/m`: the selected one, else the first,
 * which the card edits when nothing is selected (windsor#75 decision 2).
 * Null when the part has no region, so the rail shows none.
 */
export function regionBadge(selected: number | null, count: number): RegionBadge | null {
  if (count <= 0) return null;
  const chosen = selected !== null && selected >= 0 && selected < count;
  const n = chosen ? selected + 1 : 1;
  return {
    text: `${n}/${count}`,
    title: chosen
      ? `Region ${n} of ${count}`
      : `Region ${n} of ${count}: click a region on the lane to split or delete it`,
  };
}

/** Whether Split can cut `region` in two at its middle bar: it must be two `bar`s or longer. */
export const canSplitRegion = (
  region: Pick<PartRegion, 'duration'> | null | undefined,
  bar: number = TICKS_PER_BAR,
): boolean => region != null && region.duration >= 2 * bar;

/**
 * Split on the rail: region `region` of the part on `slot`, as `doc` holds
 * it now, cut at its middle bar (the modifier-free grain is the song's bar, whatever
 * the region's own step), both halves holding its pattern. Null when the
 * part or the region is gone or is shorter than two bars.
 */
export function splitRegionAtMiddle(
  doc: ArrangementDocument,
  slot: number,
  region: number,
): PartRegion[] | null {
  const part = partAt(doc, slot);
  const target = part?.regions[region];
  const bar = ticksPerBar(doc.transport.meter);
  if (!part || !target || !canSplitRegion(target, bar)) return null;
  return splitPartRegion(part, region, target.start + target.duration / 2, false, bar);
}

/** Delete on the rail: the part's regions as `doc` holds them now, less region `region`; null when it is gone. */
export function removeRegionAt(
  doc: ArrangementDocument,
  slot: number,
  region: number,
): PartRegion[] | null {
  const part = partAt(doc, slot);
  if (!part?.regions[region]) return null;
  return deleteRegion(part.regions, region);
}

/**
 * Which devices are folded to their rail: session state, kept by part slot
 * so a repaint, a region change or a reselect draws the device as it was
 * left. Nothing reaches the document.
 */
export class DeviceFolds {
  private readonly folded = new Set<number>();

  isFolded(slot: number): boolean {
    return this.folded.has(slot);
  }

  /** Fold or unfold the device on `slot`; returns whether it is folded now. */
  toggle(slot: number): boolean {
    if (this.folded.delete(slot)) return false;
    this.folded.add(slot);
    return true;
  }
}

/** The console's one fold memory. */
export const DEVICE_FOLDS = new DeviceFolds();
