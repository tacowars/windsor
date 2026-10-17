/**
 * Which region the piano roll opened wide follows to when a part is picked
 * (windsor#873; record `2026-10-17-expanded-roll-follows-the-part`
 * decision 2), as a rule with no DOM. The Song view asks it when a pick
 * moves its selection to a part, and selects the region it names, so the
 * pane draws that region's Roll and the card takes the open view over.
 */
import type { ArrangementDocument } from '@windsor/engine';
import { partAt, regionState, songTicksOf } from '@windsor/engine';

/** The roll open wide: its part and the region it edits (none: the part's sequencer). */
export interface WideRoll {
  readonly slot: number;
  readonly region: number | undefined;
}

/** What the rule reads beside the document. */
export interface FollowInput {
  /** The roll open wide, or null when none is. */
  readonly open: WideRoll | null;
  /** The transport tick under the playhead. */
  readonly tick: number;
}

/**
 * The region of part `slot` the open roll follows to, or null to leave the
 * pane's own choice (its first region):
 *
 * - no roll is open wide, or `slot` is not a Roll part: null;
 * - the roll is already open on `slot` (a pick back after a part that is
 *   not a Roll): the region it shows, so the view stays where it is;
 * - otherwise the region under the playhead, or null in a gap.
 */
export function followedRegion(
  doc: ArrangementDocument,
  slot: number,
  { open, tick }: FollowInput,
): number | null {
  if (!open) return null;
  const part = partAt(doc, slot);
  if (part?.sequencer.kind !== 'roll') return null;
  if (open.slot === slot) return open.region ?? null;
  const state = regionState(part.regions, songTicksOf(doc), tick);
  return state.live ? state.index : null;
}
