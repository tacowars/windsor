/**
 * Insert ids in a test (windsor#186): a normalised document gives every
 * insert an `id`. A test about an insert's settings compares them without
 * it, and one about the code's default chains compares them with the ids
 * normalising fills in.
 */
import type { InsertSpec } from '../inserts/insertRegistry';
import { withInsertIds } from '../inserts/insertIds';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `value` with every `inserts` list at any depth (or `value` itself, given as
 * a list) replaced by `chain` of it. `value` is left alone.
 */
function mapChains<T>(value: T, chain: (list: unknown[]) => unknown[]): T {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isRecord(node)) return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, child]) => [
        key,
        key === 'inserts' && Array.isArray(child) ? chain(child) : walk(child),
      ]),
    );
  };
  return (Array.isArray(value) ? chain(value) : walk(value)) as T;
}

/** One insert's settings: the entry without its `id`. */
const settingsOf = (entry: unknown): unknown =>
  isRecord(entry)
    ? Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'id'))
    : entry;

/** `value` (a document, a section, or a chain given as a list) with no insert's `id`. */
export const withoutInsertIds = <T>(value: T): T =>
  mapChains(value, (list) => list.map(settingsOf));

/** `value` with every insert given the id normalising gives it, as `withInsertIds` does. */
export const withFilledInsertIds = <T>(value: T): T =>
  mapChains(value, (list) => withInsertIds(list as InsertSpec[]));

/** The ids of every insert in `value`, by chain path (`master.inserts`, `parts[0].strip.inserts`). */
export function insertIdsOf(value: unknown): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, i) => walk(entry, `${path}[${i}]`));
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, child] of Object.entries(node)) {
      const at = path === '' ? key : `${path}.${key}`;
      if (key === 'inserts' && Array.isArray(child)) {
        out[at] = child.map((entry) => (isRecord(entry) ? entry.id : undefined));
      } else walk(child, at);
    }
  };
  walk(value, '');
  return out;
}
