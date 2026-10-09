/**
 * Rec's state, without the DOM or the engine's clock (windsor#663; record
 * `2026-10-09-roll-recording` decisions 1, 7 and 9, the mockup's five looks):
 * where the selected part's playhead is, whether Rec can be armed there, and
 * which look the switch shows. Also the part's regions as the take reads
 * them (`rollTake.ts`'s `TakeRegion`).
 *
 * Rec is the console's, off at load and one for the console: it applies to
 * the selected part only, and only while that part is a Roll part.
 */
import type { ArrangementDocument } from '@windsor/engine';
import { ROLL_NOTES_MAX, partAt, regionPattern, regionState, songTicksOf } from '@windsor/engine';
import type { TakeRegion } from './rollTake';

/**
 * The switch's looks: Rec off with nothing to arm into (`no-region`, drawn
 * disabled) or live (`off`); on with the transport stopped (`armed`), in a
 * gap (`paused`), in a region (`recording`), or in a region that takes no
 * new note (`full`).
 */
export type RecLook = 'no-region' | 'off' | 'armed' | 'paused' | 'recording' | 'full';

/** Where the selected part is at the playhead. */
export interface RecPlace {
  /** The part is a Roll part. */
  readonly roll: boolean;
  /** The index of the region under the playhead, or null in a gap (or for a part that is not a Roll). */
  readonly region: number | null;
  /** That region's roll holds `ROLL_NOTES_MAX` notes and takes no new one. */
  readonly full: boolean;
}

/** The selected part `slot`'s place at transport tick `tick`. */
export function recPlace(
  doc: ArrangementDocument,
  slot: number,
  tick: number,
  max = ROLL_NOTES_MAX,
): RecPlace {
  const part = partAt(doc, slot);
  if (part?.sequencer.kind !== 'roll') return { roll: false, region: null, full: false };
  const state = regionState(part.regions, songTicksOf(doc), tick);
  if (!state.live) return { roll: true, region: null, full: false };
  const pattern = regionPattern(part, state.index);
  const full = pattern.kind === 'roll' && pattern.notes.length >= max;
  return { roll: true, region: state.index, full };
}

/** Rec can be turned on: the selected part is a Roll part with a region under the playhead. */
export const canArm = (place: RecPlace): boolean => place.roll && place.region !== null;

/** What the look is read from. */
export interface RecInput {
  readonly armed: boolean;
  readonly running: boolean;
  readonly place: RecPlace;
}

/**
 * The switch's look. Once armed, Rec stays live wherever the playhead goes
 * (decision 7), so `paused` can always be turned off; off, it is live only
 * where it could be armed.
 */
export function recLook({ armed, running, place }: RecInput): RecLook {
  if (!armed) return canArm(place) ? 'off' : 'no-region';
  if (!running) return 'armed';
  if (!canArm(place)) return 'paused';
  return place.full ? 'full' : 'recording';
}

/** Rec is on, in any of its looks. */
export const recOn = (look: RecLook): boolean => look !== 'no-region' && look !== 'off';

/** Part `slot`'s regions as the take reads them, each with the loop of the roll it plays. */
export function takeRegions(doc: ArrangementDocument, slot: number): TakeRegion[] {
  const part = partAt(doc, slot);
  if (!part) return [];
  return part.regions.map((region, index) => {
    const pattern = regionPattern(part, index);
    const loopTicks = pattern.kind === 'roll' ? pattern.loopTicks : region.duration;
    return { start: region.start, duration: region.duration, loopTicks };
  });
}
