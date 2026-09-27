/**
 * A strip's insert list, edited (#641). Pure: each returns the whole next
 * list, which is what a live partial carries, since an array in a partial
 * replaces the document's wholesale. The engine compares it with the live
 * chain: the same kinds in the same order are param writes, anything else
 * rebuilds that one strip's inserts.
 */
import type { InsertKindName, InsertSpec } from '@windsor/engine';
import { INSERT_KINDS, MAX_INSERTS } from '@windsor/engine';

/** Whether a strip holding `list` has room for another insert. */
export const canAddInsert = (list: readonly InsertSpec[]): boolean => list.length < MAX_INSERTS;

/** `list` with a fresh insert of `kind` on the end, or `list` unchanged when it is full. */
export function addInsert(list: readonly InsertSpec[], kind: InsertKindName): InsertSpec[] {
  if (!canAddInsert(list)) return [...list];
  return [...list, structuredClone(INSERT_KINDS[kind].defaults)];
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
