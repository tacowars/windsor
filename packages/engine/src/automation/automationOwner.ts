/**
 * Whose lanes a lane list is (windsor#614, record
 * `2026-10-05-group-automation-folder-tracks` decision 4): a music part's, by
 * its slot, or a group bus's, by its id. The automation player and its
 * resolver key every lane list by its owner, so a part and a group whose
 * slot and id happen to be equal never share lanes.
 *
 * A lane's target id is relative to its owner (`automationTargets.ts`): a
 * group owns a subset of a part's targets (`isGroupTarget`).
 */

/** A music part's lanes, by slot. */
export interface PartOwner {
  readonly part: number;
}

/** A group bus's lanes, by the group's id. */
export interface GroupOwner {
  readonly group: number;
}

/** Who owns a lane list. */
export type AutomationOwner = PartOwner | GroupOwner;

/** The owner of the part on `slot`. */
export const partOwner = (slot: number): PartOwner => ({ part: slot });

/** The owner of the group `id`. */
export const groupOwner = (id: number): GroupOwner => ({ group: id });

/** Whether `owner` is a group's. */
export const isGroupOwner = (owner: AutomationOwner): owner is GroupOwner => 'group' in owner;

/** A string naming `owner` and nothing else: what the player keys its maps by. */
export const ownerKey = (owner: AutomationOwner): string =>
  isGroupOwner(owner) ? `group:${owner.group}` : `part:${owner.part}`;

/** Whether `a` and `b` name the same owner. */
export const sameOwner = (a: AutomationOwner, b: AutomationOwner): boolean =>
  ownerKey(a) === ownerKey(b);
