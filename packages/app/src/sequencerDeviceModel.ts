/**
 * What the sequencer device's rail says and allows (windsor#368, record
 * `2026-10-01-sequencer-rack-devices` decision 2), without the DOM: the
 * region as `n/m`, whether Split and Delete can act, and which devices are
 * folded to their rail. Split and Delete act on the selected region exactly
 * as the pane's buttons did before the rail held them: Split needs a region
 * of two bars or more, and neither acts with no region selected.
 */
import type { PartRegion } from '@windsor/engine';
import { TICKS_PER_BAR } from '@windsor/engine';

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

/** Whether Split can cut `region` in two at its middle bar: it must be two bars or longer. */
export const canSplitRegion = (region: Pick<PartRegion, 'duration'> | null | undefined): boolean =>
  region != null && region.duration >= 2 * TICKS_PER_BAR;

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
