/**
 * Fit region to pattern (windsor#827; record `2026-10-16-song-tab-context-menu`,
 * decision 2): a region's length set to one pass of its pattern, pure so it is
 * tested in Node. A pass is the cycle the region's block already draws its
 * ticks from (`CYCLE_TICKS`, read with the region's own pattern and the song's
 * meter); where that gives none (Arp, a Figure canon, a Chord or Grid with no
 * steps, a part with no sequencer) there is no fit.
 *
 * The region's start stays put. Its end goes where a trim to start + pass
 * would put it (`resizeRegionEnd`): snapped to the finest grain the region's
 * edges take (`regionGrain` with the modifier: its own step on Grid, Chord
 * and Euclid, else the beat), so a pass off that grain rounds to its nearest
 * step, and clipped to the next region and the song's end. An empty roll's
 * loop follows the new length, as it does on a trim (`fitEmptyRolls`).
 */
import type { Meter, MusicPart, PartRegion } from '@windsor/engine';
import { PPQ, regionPattern } from '@windsor/engine';
import { regionGrain } from './partEdits';
import { resizeRegionEnd } from './regionModel';
import { fitEmptyRolls } from './rollRegionFit';
import { CYCLE_TICKS, forKind } from './songViewTables';

/** The tag's words, and how finely it counts a length (hundredths). */
export const REGION_FIT_TEXT = {
  alreadyFits: 'already fits',
  per: 100,
} as const;

/** The song a fit happens in. */
export interface FitSong {
  readonly meter: Meter | undefined;
  /** One bar of `meter`, in ticks. */
  readonly bar: number;
  readonly songTicks: number;
}

/** A fit of one region: the part's regions after it, the region's new length, and the menu's tag. */
export interface RegionFit {
  readonly regions: PartRegion[];
  readonly index: number;
  readonly start: number;
  readonly duration: number;
  /** True when the fit leaves the region as long as it is: one pass already, or no room to grow. */
  readonly fits: boolean;
  /** `already fits`, else the new length: `3 bars`, `1 bar`, or beats under a bar. */
  readonly tag: string;
}

const counted = (ticks: number, unit: number): number =>
  Math.round((ticks / unit) * REGION_FIT_TEXT.per) / REGION_FIT_TEXT.per;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A length as the tag says it: bars from one bar up, beats under it. */
export function fitLengthText(ticks: number, bar: number): string {
  return ticks >= bar ? plural(counted(ticks, bar), 'bar') : plural(counted(ticks, PPQ), 'beat');
}

/** One pass of region `index`'s pattern, in ticks; null where it has no cycle. */
export function regionCycle(
  part: Pick<MusicPart, 'regions' | 'sequencer'>,
  index: number,
  meter: Meter | undefined,
): number | null {
  if (!part.regions[index]) return null;
  const cycle = forKind(CYCLE_TICKS, regionPattern(part, index), meter);
  return cycle !== null && cycle > 0 ? cycle : null;
}

/** Fit region `index` of `part` to one pass of its pattern; null where Fit isn't offered. */
export function regionFit(
  part: Pick<MusicPart, 'regions' | 'sequencer'>,
  index: number,
  song: FitSong,
): RegionFit | null {
  const region = part.regions[index];
  const cycle = regionCycle(part, index, song.meter);
  if (!region || cycle === null) return null;
  const grain = regionGrain(part, index, true, song.bar);
  const resized = resizeRegionEnd(part.regions, index, region.start + cycle, song.songTicks, grain);
  const regions = fitEmptyRolls(resized, part.regions);
  const duration = regions[index]?.duration ?? region.duration;
  const fits = duration === region.duration;
  const tag = fits ? REGION_FIT_TEXT.alreadyFits : fitLengthText(duration, song.bar);
  return { regions, index, start: region.start, duration, fits, tag };
}
