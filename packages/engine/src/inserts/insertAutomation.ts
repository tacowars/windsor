/**
 * An insert target's automation handle (windsor#345, record
 * `2026-10-01-song-automation-lanes` decisions 2 and 9): a lane on one of a
 * strip's inserts, by the insert's stable id and the field it moves, found
 * on the live stage that insert sits on as `stage.param(field)`.
 *
 * - **Inert while unread.** A field outside `automatableInsertFields` for
 *   the insert's current spec (Tape's `wear` while split, say) has no
 *   handle: the player schedules nothing for the lane, and the param stays
 *   the spec's. A spec edit resyncs the part's lanes (`system/songAutomation.ts`),
 *   so the lane is picked up from then once the field is read again.
 * - **The stage of the moment.** The resolver asks again after every insert
 *   edit and every chain rebuild, so a reordered, added or removed insert
 *   re-attaches the lanes that remain, and a lane whose insert has gone
 *   finds nothing.
 *
 * The resolver (`system/automationResolver.ts`) has already found the
 * insert's row in the catalog, so `field` is one its kind automates.
 */
import type { AutomationHandle } from '../automation/automationHandles';
import { automatableInsertFields } from '../automation/automationInsertFields';
import type { AutomationTargetRow } from '../automation/automationLane';
import type { PartStrip } from '../mixer/channelStrip';

/** Which insert and which of its fields a lane moves. */
export interface InsertTarget {
  readonly insertId: string;
  readonly field: string;
}

/** The handle for `target` on `strip`'s live inserts, or undefined when there is none. */
export function insertAutomationHandle(
  strip: PartStrip,
  target: InsertTarget,
  _row: AutomationTargetRow,
): AutomationHandle | undefined {
  const index = strip.insertSpecs.findIndex((insert) => insert.id === target.insertId);
  const spec = strip.insertSpecs[index];
  const stage = strip.inserts[index];
  if (!spec || stage?.kind !== spec.kind) return undefined;
  const read = automatableInsertFields(spec).some((row) => row.target === target.field);
  return read ? stage.param?.(target.field) : undefined;
}
