/**
 * A strip's insert list, edited (#641). Pure: each returns the whole next
 * list, which is what a live partial carries, since an array in a partial
 * replaces the document's wholesale. The engine compares it with the live
 * chain: the same kinds in the same order are param writes, anything else
 * rebuilds that one strip's inserts.
 */
import type { InsertKindName, InsertSpec } from '@windsor/engine';
import { INSERT_KINDS, MAX_INSERTS, onSendBus } from '@windsor/engine';
import type { InsertTarget } from './insertTarget';
import { isBusTarget } from './insertTarget';

/** Whether a strip holding `list` has room for another insert. */
export const canAddInsert = (list: readonly InsertSpec[]): boolean => list.length < MAX_INSERTS;

/**
 * `list` with a fresh insert of `kind` on the end, or `list` unchanged when it
 * is full. On a send bus a Plate reverb or an Echo starts fully wet, the way
 * the engine's own buses hold them (`onSendBus`, windsor#172); everywhere
 * else, and every other kind, starts at the kind's defaults.
 */
export function addInsert(
  list: readonly InsertSpec[],
  kind: InsertKindName,
  target?: InsertTarget,
): InsertSpec[] {
  if (!canAddInsert(list)) return [...list];
  const fresh = structuredClone(INSERT_KINDS[kind].defaults);
  return [...list, target !== undefined && isBusTarget(target) ? onSendBus(fresh) : fresh];
}

/**
 * `list` with a fresh insert of `kind` at the front (windsor#173, the rack's
 * left Add slot): `addInsert`'s insert for the same `target`, so a send
 * bus's Plate reverb or Echo starts fully wet here too, moved to index 0.
 * Unchanged when full.
 */
export function addInsertAtFront(
  list: readonly InsertSpec[],
  kind: InsertKindName,
  target?: InsertTarget,
): InsertSpec[] {
  const added = addInsert(list, kind, target);
  if (added.length === list.length) return added;
  return [added[added.length - 1]!, ...added.slice(0, -1)];
}

/** `list` without the insert at `index`. */
export function removeInsert(list: readonly InsertSpec[], index: number): InsertSpec[] {
  return list.filter((_, i) => i !== index);
}

/**
 * `list` with the insert at `index` swapped with its neighbour `delta` places
 * along (#652): −1 towards the front of the chain, +1 towards the back. Off
 * either end, or an index the list does not hold, returns the list unchanged.
 */
export function moveInsert(
  list: readonly InsertSpec[],
  index: number,
  delta: number,
): InsertSpec[] {
  const to = index + delta;
  const out = [...list];
  if (index < 0 || index >= out.length || to < 0 || to >= out.length) return out;
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
}

/** `list` with one field of the insert at `index` set; any other index leaves it as it was. */
export function setInsertField(
  list: readonly InsertSpec[],
  index: number,
  field: string,
  value: number | boolean,
): InsertSpec[] {
  return list.map((spec, i) => (i === index ? ({ ...spec, [field]: value } as InsertSpec) : spec));
}
