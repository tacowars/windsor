/**
 * The song's group buses as the console edits them (windsor#287; record
 * `2026-10-01-group-buses` decisions 2, 3, 6 and 7): what Add group, a
 * rename, Remove and a part's Output write, the next group's name and id,
 * and the members line under a group's knobs. Every builder is pure over the
 * normalised document and returns a `DocumentPartial`, groups keyed by id
 * and parts by slot, as `documentModel.ts` merges them; the commits at the
 * end send one through `ctx.change` as one named undo step. The panel
 * (`groupsPanel.ts`) only draws and calls them.
 */
import type {
  ArrangementDocument,
  ChannelStrip,
  DocumentPartial,
  GroupSpec,
} from '@windsor/engine';
import { DEFAULT_GROUP, MAX_GROUPS, isGroupOutput } from '@windsor/engine';
import type { AppCtx } from './context';
import { withGesture } from './gestureHooks';
import type { StripOutput } from './songMixerModel';

/** The two switches a group has, as a part's strip has. */
export type GroupSwitch = 'mute' | 'solo';

/** What a group's name starts with when Add group names it: `Group 1`, `Group 2`… */
const GROUP_NAME_STEM = 'Group';

/** The prefix a group's key carries, so it never reads as a slot, `master`, `sidechain` or a bus. */
const GROUP_KEY_PREFIX = 'group:';

/** The members line of a group no part plays through. */
export const NO_MEMBERS = 'No part plays here yet';

/** Add group's title once the song holds `MAX_GROUPS`. */
export const GROUPS_FULL_TITLE = `A song can have ${MAX_GROUPS} groups`;

/** The song's groups in display order; a song with none has an empty list. */
export const groupsOf = (doc: ArrangementDocument): readonly GroupSpec[] => doc.groups ?? [];

/** The group with `id`, if the song has one. */
export const groupAt = (doc: ArrangementDocument, id: number): GroupSpec | undefined =>
  groupsOf(doc).find((group) => group.id === id);

/** A group's key, `group:3`: an Output select value and an insert target. */
export const groupKey = (id: number): `group:${number}` => `${GROUP_KEY_PREFIX}${id}`;

/** The id a key names, or null for anything that isn't a group's key. */
export function groupIdOfKey(key: string): number | null {
  if (!key.startsWith(GROUP_KEY_PREFIX)) return null;
  const digits = key.slice(GROUP_KEY_PREFIX.length);
  const id = Number(digits);
  return /^\d+$/.test(digits) && Number.isSafeInteger(id) ? id : null;
}

/** The Output select's value for `output`: `master`, `sidechain` or a group's key. */
export const outputValue = (output: StripOutput): string =>
  isGroupOutput(output) ? groupKey(output.group) : output;

/** The Output a select value names; anything unknown is Master. */
export function outputOfValue(value: string): StripOutput {
  if (value === 'sidechain') return 'sidechain';
  const id = groupIdOfKey(value);
  return id === null ? 'master' : { group: id };
}

/** Whether `output` routes to the group with `id`. */
const routesTo = (output: ChannelStrip['output'], id: number): boolean =>
  isGroupOutput(output) && output.group === id;

/** Whether the song has room for another group. */
export const canAddGroup = (doc: ArrangementDocument): boolean => groupsOf(doc).length < MAX_GROUPS;

/** The next group's id: one more than the largest, or 1 in a song with none. */
export const nextGroupId = (doc: ArrangementDocument): number =>
  Math.max(0, ...groupsOf(doc).map((group) => group.id)) + 1;

/** The next group's name: `Group <n>` at the lowest n no group's name uses. */
export function nextGroupName(doc: ArrangementDocument): string {
  const used = new Set(groupsOf(doc).map((group) => group.name));
  let n = 1;
  while (used.has(`${GROUP_NAME_STEM} ${n}`)) n++;
  return `${GROUP_NAME_STEM} ${n}`;
}

/** The new group Add group appends, at the defaults, or null when the song is full. */
export function addGroupChange(doc: ArrangementDocument): DocumentPartial | null {
  if (!canAddGroup(doc)) return null;
  const id = nextGroupId(doc);
  const group: GroupSpec = { id, name: nextGroupName(doc), ...structuredClone(DEFAULT_GROUP) };
  return { groups: { [id]: group } };
}

/**
 * The rename `name` asks for, trimmed; null when it changes nothing: an
 * empty name (the field reverts), the name the group has, or no such group.
 */
export function renameGroupChange(
  doc: ArrangementDocument,
  id: number,
  name: string,
): DocumentPartial | null {
  const next = name.trim();
  const group = groupAt(doc, id);
  if (!group || next === '' || next === group.name) return null;
  return { groups: { [id]: { name: next } } };
}

/** The slots of the parts whose Output is the group, in slot order. */
export const memberSlots = (doc: ArrangementDocument, id: number): number[] =>
  doc.parts
    .filter((part) => routesTo(part.strip.output, id))
    .map((part) => part.slot)
    .sort((a, b) => a - b);

/** Removing the group: every member back to Master and the group gone, in one partial. */
export function removeGroupChange(doc: ArrangementDocument, id: number): DocumentPartial | null {
  if (!groupAt(doc, id)) return null;
  const parts = Object.fromEntries(
    memberSlots(doc, id).map((slot) => [slot, { strip: { output: 'master' } }]),
  );
  return { groups: { [id]: null }, parts } as DocumentPartial;
}

/** A part's Output set to `output`: Master, Sidechain or a group. */
export const routeChange = (slot: number, output: StripOutput): DocumentPartial =>
  ({ parts: { [slot]: { strip: { output } } } }) as DocumentPartial;

/** The names of the group's members, in slot order. */
export function groupMembers(doc: ArrangementDocument, id: number): string[] {
  const slots = new Set(memberSlots(doc, id));
  return [...doc.parts]
    .sort((a, b) => a.slot - b.slot)
    .filter((part) => slots.has(part.slot))
    .map((part) => part.name);
}

/** The members line: "Kick, Snare, Hats", or `NO_MEMBERS`. */
export const membersLine = (members: readonly string[]): string =>
  members.length ? members.join(', ') : NO_MEMBERS;

/** Whether the group's switch is on; a missing field is off. */
export const groupSwitchOn = (group: GroupSpec, which: GroupSwitch): boolean =>
  group[which] === true;

/** The switch flipped, or null when there is no such group. */
export function groupSwitchChange(
  doc: ArrangementDocument,
  id: number,
  which: GroupSwitch,
): DocumentPartial | null {
  const group = groupAt(doc, id);
  if (!group) return null;
  return { groups: { [id]: { [which]: !groupSwitchOn(group, which) } } };
}

const SWITCH_VERB: Readonly<Record<GroupSwitch, string>> = { mute: 'Mute', solo: 'Solo' };

/** A group switch's label, its `aria-label` and its undo step: "Mute Drums". */
export const groupSwitchLabel = (which: GroupSwitch, name: string): string =>
  `${SWITCH_VERB[which]} ${name}`;

/** Send `partial` as one undo step named `label`; false when there was none or it was refused. */
function commit(ctx: AppCtx, label: string, partial: DocumentPartial | null): boolean {
  if (!partial) return false;
  return withGesture(label, () => ctx.change(partial)).ok;
}

/** Add group: one step, "Add Group 2". */
export const addGroup = (ctx: AppCtx): boolean =>
  commit(ctx, `Add ${nextGroupName(ctx.model.doc)}`, addGroupChange(ctx.model.doc));

/** Rename the group: one step, or nothing when the name is empty or unchanged. */
export const renameGroup = (ctx: AppCtx, id: number, name: string): boolean =>
  commit(ctx, `Rename ${name.trim()}`, renameGroupChange(ctx.model.doc, id, name));

/** Remove the group and send its members to Master: one step, "Remove Drums". */
export const removeGroup = (ctx: AppCtx, id: number): boolean =>
  commit(
    ctx,
    `Remove ${groupAt(ctx.model.doc, id)?.name ?? ''}`.trim(),
    removeGroupChange(ctx.model.doc, id),
  );

/** Flip the group's mute or solo: one step named after the group. */
export const toggleGroupSwitch = (ctx: AppCtx, id: number, which: GroupSwitch): boolean =>
  commit(
    ctx,
    groupSwitchLabel(which, groupAt(ctx.model.doc, id)?.name ?? ''),
    groupSwitchChange(ctx.model.doc, id, which),
  );
