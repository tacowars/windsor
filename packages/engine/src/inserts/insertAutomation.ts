/**
 * An insert target's automation handle (record
 * `2026-10-01-song-automation-lanes` decisions 2 and 9): a lane on one of a
 * strip's inserts, by the insert's stable id and the field it moves.
 *
 * A stub until windsor#345 gives the insert registry its parameter
 * descriptors and `stage.param(field)`: it finds nothing, so the automation
 * player (windsor#344) leaves every insert lane unplayed. windsor#345 fills
 * this file and never touches the resolver (`system/automationResolver.ts`).
 */
import type { AutomationHandle } from '../automation/automationHandles';
import type { AutomationTargetRow } from '../automation/automationLane';
import type { PartStrip } from '../mixer/channelStrip';

/** Which insert and which of its fields a lane moves. */
export interface InsertTarget {
  readonly insertId: string;
  readonly field: string;
}

/** The handle for `target` on `strip`'s live inserts, or undefined when there is none. */
export function insertAutomationHandle(
  _strip: PartStrip,
  _target: InsertTarget,
  _row: AutomationTargetRow,
): AutomationHandle | undefined {
  return undefined;
}
