/**
 * The song's group buses (windsor#284; record `2026-10-01-group-buses`
 * decisions 2, 3 and 7): the `groups` list, read in display order, and the
 * pass that sends a part whose Output names a group the song lacks back to
 * Master. Never refuses: a group that can't be read is dropped, and a part
 * that names one is played on Master, each with a correction.
 *
 * A group's `automation` (windsor#614, record
 * `2026-10-05-group-automation-folder-tracks` decision 3) is read by
 * `normaliseAutomation` against the group's normalised inserts and the song's
 * length, as a part's is, with the group's narrower targets. Absent or empty,
 * the group has no `automation` key, so a song without group lanes writes
 * exactly what it wrote before.
 */
import type { FieldNormaliser } from './arrangementFields';
import { isRecord, show } from './arrangementFields';
import type { ArrangementDocument } from './arrangementDocument';
import { normaliseAutomation } from './automationNormalise';
import { normaliseBusInserts, switchedOn } from './deskNormalise';
import { MAX_GROUPS, MIX_LEVEL_MAX } from '../audioConstants';
import type { GroupSpec } from '../mixer/mix';
import { DEFAULT_GROUP, isGroupOutput } from '../mixer/mix';

const GROUP_KEYS = ['id', 'name', 'level', 'pan', 'mute', 'solo', 'inserts', 'automation'];

/**
 * The `groups` list: at most `MAX_GROUPS`, each on a unique id. A group with
 * a missing, junk or duplicate id is dropped, as is every one after the
 * eighth kept. An absent or empty list is absent. `songTicks` is the song's
 * length, which a group's lanes are fitted to; without it (a live group
 * read on its own, whose lanes the live automation reads) no lane is cut.
 */
export function normaliseGroups(
  raw: unknown,
  n: FieldNormaliser,
  songTicks = Number.POSITIVE_INFINITY,
): GroupSpec[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    n.correction(`groups: ${show(raw)} is not a list of groups — dropped`);
    return undefined;
  }
  const out: GroupSpec[] = [];
  const used = new Set<number>();
  raw.forEach((entry: unknown, i) => {
    const path = `groups[${i}]`;
    if (out.length === MAX_GROUPS) {
      n.correction(`${path}: a song holds at most ${MAX_GROUPS} groups — group dropped`);
      return;
    }
    const group = normaliseGroup(entry, { path, position: out.length + 1, songTicks }, n);
    if (!group) return;
    if (used.has(group.id)) {
      n.correction(`${path}.id: ${group.id} is already used — group dropped`);
      return;
    }
    used.add(group.id);
    out.push(group);
  });
  return out.length > 0 ? out : undefined;
}

/** Where a group sits: its path, its place among the kept groups from 1, and the song's length. */
interface GroupPlace {
  readonly path: string;
  readonly position: number;
  readonly songTicks: number;
}

/** One group, or null when it has no usable id. */
function normaliseGroup(raw: unknown, place: GroupPlace, n: FieldNormaliser): GroupSpec | null {
  const { path, position } = place;
  if (!isRecord(raw)) {
    n.correction(`${path}: ${show(raw)} is not a group — group dropped`);
    return null;
  }
  n.dropUnknown(raw, GROUP_KEYS, path);
  const id = raw.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) {
    n.correction(`${path}.id: ${show(id)} is not a non-negative integer — group dropped`);
    return null;
  }
  // A group's name follows a part's rule: any string is kept.
  const fallbackName = `Group ${position}`;
  if (raw.name !== undefined && typeof raw.name !== 'string') {
    n.correction(`${path}.name: ${show(raw.name)} is not a name — using "${fallbackName}"`);
  }
  const base = DEFAULT_GROUP;
  // Read as a send bus's chain: a compressor keys from the group's own input.
  const inserts = normaliseBusInserts(raw.inserts, `${path}.inserts`, n, base.inserts, 'a group');
  const automation = normaliseAutomation(raw.automation, {
    songTicks: place.songTicks,
    inserts,
    owner: 'group',
    path: `${path}.automation`,
    n,
  });
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : fallbackName,
    level: n.num(raw.level, base.level, 0, MIX_LEVEL_MAX, `${path}.level`),
    pan: n.num(raw.pan, base.pan, -1, 1, `${path}.pan`),
    ...switchedOn('mute', raw.mute, path, n),
    ...switchedOn('solo', raw.solo, path, n),
    inserts,
    ...(automation ? { automation } : {}),
  };
}

/**
 * The pass over a finished document (record decision 7): a part whose
 * Output names a group the document doesn't hold plays on Master, with a
 * correction and a dangling entry, addressed by slot as the sidechain
 * pass addresses its own. Returns `document` itself when every
 * Output is good.
 */
export function normaliseGroupOutputs(
  document: ArrangementDocument,
  n?: FieldNormaliser,
): ArrangementDocument {
  const ids = new Set((document.groups ?? []).map((group) => group.id));
  let changed = false;
  const parts = document.parts.map((part) => {
    const output = part.strip.output;
    if (!isGroupOutput(output) || ids.has(output.group)) return part;
    const path = `parts.${part.slot}.strip.output`;
    n?.dangling.push(`${path}: no group ${output.group} is defined`);
    n?.correction(`${path}: no group ${output.group} is defined — Master`);
    changed = true;
    return { ...part, strip: { ...part.strip, output: 'master' as const } };
  });
  return changed ? { ...document, parts } : document;
}
