/**
 * Whose automation lanes a lane row edits on the Song view (windsor#616;
 * record `2026-10-05-group-automation-folder-tracks`): a part, or a group
 * bus on its folder track. The owner is the document's own object, a
 * `DocumentPart` or a `GroupSpec`, so the part path hands its part in
 * unchanged and every lane rule (`songAutomationModel.ts`) reads either.
 *
 * What differs between the two is here and nowhere else: where the owner's
 * inserts and its level and pan live, the key its rows' focus and Shape
 * range go by, the partial its lanes are written with, and how a stale copy
 * is found again in the document. A group has no sends, voice, macros or
 * sequencer, so its targets are `isGroupTarget`'s (the engine's).
 */
import type {
  AutomationLane,
  DocumentPart,
  DocumentPartial,
  GroupSpec,
  InsertSpec,
} from '@windsor/engine';

/** A part or a group bus: what owns a list of lanes. */
export type LaneOwner = DocumentPart | GroupSpec;

/** What the owner is looked up again from: the document's parts and groups. */
export interface OwnerDoc {
  readonly parts: readonly DocumentPart[];
  readonly groups?: readonly GroupSpec[];
}

/** Whether `owner` is a group bus: a part carries a strip, a group does not. */
export const isGroupLaneOwner = (owner: LaneOwner): owner is GroupSpec => !('strip' in owner);

/** The owner's lanes; none when it has no `automation`. */
export const ownerLanes = (owner: LaneOwner): readonly AutomationLane[] => owner.automation ?? [];

/** The owner's insert chain: a part's strip's, or the group's own. */
export const ownerInserts = (owner: LaneOwner): readonly InsertSpec[] =>
  isGroupLaneOwner(owner) ? owner.inserts : owner.strip.inserts;

/** Where the owner's level and pan are read: a part's strip, or the group itself. */
export const ownerStrip = (owner: LaneOwner): object =>
  isGroupLaneOwner(owner) ? owner : owner.strip;

/**
 * The key the owner's rows go by across repaints (focus, the Shape range):
 * a part's slot, as before windsor#616, or `group:<id>`, which no slot is.
 */
export const ownerKey = (owner: LaneOwner): string =>
  isGroupLaneOwner(owner) ? `group:${owner.id}` : String(owner.slot);

/** The partial that sets the owner's lanes to `lanes`, whole: a part's by slot, a group's by id. */
export const ownerAutomationChange = (
  owner: LaneOwner,
  lanes: readonly AutomationLane[],
): DocumentPartial =>
  isGroupLaneOwner(owner)
    ? { groups: { [owner.id]: { automation: lanes } } }
    : { parts: { [owner.slot]: { automation: lanes } } };

/** The owner as `doc` holds it now, so an edit never builds on a stale list; `owner` when it is gone. */
export function liveOwner(doc: OwnerDoc, owner: LaneOwner): LaneOwner {
  if (isGroupLaneOwner(owner)) return doc.groups?.find((g) => g.id === owner.id) ?? owner;
  return doc.parts.find((p) => p.slot === owner.slot) ?? owner;
}
