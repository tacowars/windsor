/**
 * The chord a chord card's tiles name and sound (windsor#100): the harmony
 * chord of the card's selected region. While the audible tick is inside that
 * region it is the chord under the playhead, as the sequencer will play it;
 * anywhere else — stopped before it, or playing another region — it is the
 * chord at the region's start, the first one the region plays. A card with
 * no region (the part's own sequencer), a region the part no longer has, or
 * a whole-song ∞ region reads the chord under the playhead.
 *
 * One rule for the Hit tile's label, its audition and a step tile's audition.
 * Inside-or-not is the engine's `regionState`, the gate's own reading, so a
 * tick past the song's end wraps the way playback does.
 */
import type { AppCtx } from './context';
import type { Harmony, HarmonyChord, Region } from '@windsor/engine';
import { partAt, regionState, songTicksOf } from '@windsor/engine';
import { currentChord } from './chordStepModel';
import { audibleTick } from './stepStrip';

/** What the rule reads: the song's harmony and length, the part's regions, the region and the tick. */
export interface RegionChordInput {
  harmony: Harmony;
  songTicks: number;
  regions: readonly Region[];
  /** The card's region index; undefined for the part's own sequencer. */
  region: number | undefined;
  /** The audible tick. */
  tick: number;
}

/** The tick whose chord the tiles use: the playhead inside the region, else the region's start. */
export function regionChordTick(input: RegionChordInput): number {
  const { regions, region, songTicks, tick } = input;
  if (region === undefined) return tick;
  const selected = regions[region];
  if (selected === undefined) return tick;
  const state = regionState(regions, songTicks, tick);
  return state.live && state.index === region ? tick : selected.start;
}

/** The selected region's chord, from values: null with an empty harmony timeline. */
export function chordForRegion(input: RegionChordInput): HarmonyChord | null {
  return currentChord(input.harmony, input.songTicks, regionChordTick(input));
}

/** The chord the card for `slot`'s region `region` names and sounds now. */
export function regionChord(
  ctx: AppCtx,
  slot: number,
  region: number | undefined,
): HarmonyChord | null {
  const { doc } = ctx.model;
  return chordForRegion({
    harmony: doc.harmony,
    songTicks: songTicksOf(doc),
    regions: partAt(doc, slot)?.regions ?? [],
    region,
    tick: audibleTick(ctx),
  });
}
