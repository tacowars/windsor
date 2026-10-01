/**
 * The song's group buses (windsor#284; record `2026-10-01-group-buses`
 * decisions 2, 3 and 7): the `groups` list, read in display order, and the
 * pass that sends a part whose Output names a group the song lacks back to
 * Master. Never refuses: a group that can't be read is dropped, and a part
 * that names one is played on Master, each with a correction.
 */
import type { FieldNormaliser } from './arrangementFields';
import { isRecord, show } from './arrangementFields';
import type { ArrangementDocument } from './arrangementDocument';
import { normaliseBusInserts, switchedOn } from './deskNormalise';
import { MAX_GROUPS, MIX_LEVEL_MAX } from '../audioConstants';
import type { GroupSpec } from '../mixer/mix';
import { DEFAULT_GROUP, isGroupOutput } from '../mixer/mix';

const GROUP_KEYS = ['id', 'name', 'level', 'pan', 'mute', 'solo', 'inserts'];

/**
 * The `groups` list: at most `MAX_GROUPS`, each on a unique id. A group with
 * a missing, junk or duplicate id is dropped, as is every one after the
 * eighth kept. An absent or empty list is absent.
 */
export function normaliseGroups(raw: unknown, n: FieldNormaliser): GroupSpec[] | undefined {
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
    const group = normaliseGroup(entry, path, out.length + 1, n);
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

/** One group, or null when it has no usable id. `position` counts the kept groups from 1. */
function normaliseGroup(
  raw: unknown,
  path: string,
  position: number,
  n: FieldNormaliser,
): GroupSpec | null {
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
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : fallbackName,
    level: n.num(raw.level, base.level, 0, MIX_LEVEL_MAX, `${path}.level`),
    pan: n.num(raw.pan, base.pan, -1, 1, `${path}.pan`),
    ...switchedOn('mute', raw.mute, path, n),
    ...switchedOn('solo', raw.solo, path, n),
    // Read as a send bus's chain: a compressor keys from the group's own input.
    inserts: normaliseBusInserts(raw.inserts, `${path}.inserts`, n, base.inserts),
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
