/**
 * The difference between two normalised song documents (windsor#124; epic
 * windsor#112 decision 2; record `2026-09-29-undo-history`): the partial
 * that turns `current` into `target` when a merge applies it, so an undo or
 * a redo reaches the live system as an ordinary edit and no kind of edit
 * needs a hand-written inverse. The model's side of an undo does not merge
 * it: it adopts the snapshot itself (`DocumentModel.replace`).
 *
 * - **The keyed sections** (`parts` by slot, `patches` by id): an entry only
 *   `current` holds becomes `null`, which the merge reads as removal; one only
 *   `target` holds is sent whole; one both hold is diffed below.
 * - **Below them**, records recurse over the keys either side holds. An
 *   array, a leaf or a record whose `kind` changed is sent whole, as
 *   `deepMerge` assigns it. A key only `current` holds is sent as
 *   `undefined`.
 * - **Unchanged sections are left out**, so two equal documents diff to `{}`.
 *
 * The engine has no "absent" for the optional sections (`master`, a return,
 * `master.output`, a strip's `output`, the transport's `swing` and `loop`):
 * its live apply skips an `undefined` one and keeps what it holds.
 * `documentDiffLive` returns the partial the engine is sent, with each
 * removed section spelled out as the values the normaliser gives it when it
 * is absent, which are the values a system built without it plays. It also
 * says when no partial can reach `target` live: a restored part that the
 * slot merge would put in another place in the list.
 */
import type { ArrangementDocument, DocumentPartial } from '@windsor/engine';
import { mergeDocument } from './documentModel';

type Rec = Record<string, unknown>;
/** A key path in the partial's own terms: `parts` addressed by slot. */
type Path = readonly string[];

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What the diff of an equal pair is: left out of the partial. */
const UNCHANGED: unique symbol = Symbol('unchanged');

/** Structural equality over JSON-shaped values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
}

const keysOf = (a: unknown, b: unknown): Set<string> =>
  new Set([...Object.keys(isRecord(a) ? a : {}), ...Object.keys(isRecord(b) ? b : {})]);

/** `deepMerge` replaces a record whose `kind` changed wholesale (a sequencer, a density mod). */
const kindChanged = (a: Rec, b: Rec): boolean => 'kind' in a && 'kind' in b && a.kind !== b.kind;

/** The diff of one value: `UNCHANGED`, `undefined` for a removal, or what the merge assigns. */
function diffValue(a: unknown, b: unknown, path: Path, removed: Path[]): unknown {
  if (a === b) return UNCHANGED;
  if (b === undefined) {
    removed.push(path);
    return undefined;
  }
  if (isRecord(a) && isRecord(b) && !kindChanged(a, b)) {
    const out = diffRecord(a, b, path, removed);
    return Object.keys(out).length === 0 ? UNCHANGED : out;
  }
  return deepEqual(a, b) ? UNCHANGED : b;
}

function diffRecord(a: Rec, b: Rec, path: Path, removed: Path[]): Rec {
  const out: Rec = {};
  for (const key of keysOf(a, b)) {
    const d = diffValue(
      a[key],
      Object.hasOwn(b, key) ? b[key] : undefined,
      [...path, key],
      removed,
    );
    if (d !== UNCHANGED) out[key] = d;
  }
  return out;
}

/** A keyed section: `null` for an entry `target` lacks, the entry whole for one `current` lacks. */
function diffKeyed(a: unknown, b: unknown, path: Path, removed: Path[]): Rec | typeof UNCHANGED {
  const from = isRecord(a) ? a : {};
  const to = isRecord(b) ? b : {};
  const out: Rec = {};
  for (const key of keysOf(from, to)) {
    if (!Object.hasOwn(to, key)) out[key] = null;
    else if (!Object.hasOwn(from, key)) out[key] = to[key];
    else {
      const d = diffValue(from[key], to[key], [...path, key], removed);
      if (d !== UNCHANGED) out[key] = d;
    }
  }
  return Object.keys(out).length === 0 ? UNCHANGED : out;
}

/** The part list as the partial addresses it: by slot. */
const bySlot = (parts: unknown): Rec =>
  Object.fromEntries(
    (Array.isArray(parts) ? parts : []).map((part: unknown) => [
      String(isRecord(part) ? part.slot : ''),
      part,
    ]),
  );

function diffDocument(current: Rec, target: Rec, removed: Path[]): Rec {
  const out: Rec = {};
  for (const key of keysOf(current, target)) {
    const d =
      key === 'parts'
        ? diffKeyed(bySlot(current.parts), bySlot(target.parts), [key], removed)
        : key === 'patches'
          ? diffKeyed(current.patches, target.patches, [key], removed)
          : diffValue(current[key], target[key], [key], removed);
    if (d !== UNCHANGED) out[key] = d;
  }
  return out;
}

/** The partial that merges `current` into `target` (the model's side of an undo or a redo). */
export function documentDiff(
  current: ArrangementDocument,
  target: ArrangementDocument,
): DocumentPartial {
  return diffDocument(current as unknown as Rec, target as unknown as Rec, []) as DocumentPartial;
}

/** One step down a path: a part list by slot, a record by key. */
function child(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    return node.find((part: unknown) => isRecord(part) && String(part.slot) === key);
  }
  return isRecord(node) ? node[key] : undefined;
}

const getAt = (node: unknown, path: Path): unknown => path.reduce(child, node);

function setAt(node: unknown, path: Path, value: unknown): void {
  const parent = getAt(node, path.slice(0, -1));
  const key = path.at(-1);
  if (isRecord(parent) && key !== undefined) parent[key] = value;
}

/**
 * A value the normaliser reads as junk everywhere `value` has a field, so it
 * substitutes each field's default: records keep their keys, and every leaf
 * and list becomes `null`. An optional record inside (`master.output`) is
 * kept as a record, so its defaults are spelled out too.
 */
const junk = (value: unknown): unknown =>
  isRecord(value)
    ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, junk(v)]))
    : null;

export interface LiveDiff {
  /** What `host.apply` takes: the difference, with every removed optional section's defaults spelled out. */
  readonly live: DocumentPartial;
  /**
   * True when `live` cannot bring the live system to `target`: the slot
   * merge (`mergePartList`, and the engine's `mergeParts` alike) appends a
   * part at a slot it lacks, so a part restored anywhere but last would
   * play and show in another place. The live system is rebuilt from
   * `target` instead.
   */
  readonly rebuild: boolean;
}

const slotsOf = (parts: unknown): string =>
  (Array.isArray(parts) ? parts : [])
    .map((part: unknown) => (isRecord(part) ? String(part.slot) : ''))
    .join();

/** Whether the slot merge of `partial`'s parts into `current` lists them in `target`'s order. */
function keepsPartOrder(current: Rec, target: Rec, partial: Rec): boolean {
  const merged = mergeDocument({ parts: current.parts }, { parts: partial.parts ?? {} }) as Rec;
  return slotsOf(merged.parts) === slotsOf(target.parts);
}

/**
 * The live side of an undo or a redo. `normalise` is the model's own
 * (`DocumentModel.preview`): it reads a probe of `target` with each removed
 * section filled with junk, and what it substitutes is what that section
 * is when absent.
 */
export function documentDiffLive(
  current: ArrangementDocument,
  target: ArrangementDocument,
  normalise: (raw: unknown) => ArrangementDocument,
): LiveDiff {
  const removed: Path[] = [];
  const from = current as unknown as Rec;
  const to = target as unknown as Rec;
  const partial = diffDocument(from, to, removed);
  const rebuild = !keepsPartOrder(from, to, partial);
  if (removed.length === 0) return { live: partial as DocumentPartial, rebuild };
  const probe = structuredClone(to);
  for (const path of removed) setAt(probe, path, junk(getAt(current, path)));
  const defaults = normalise(probe);
  const live = structuredClone(partial);
  for (const path of removed) setAt(live, path, getAt(defaults, path));
  return { live: live as DocumentPartial, rebuild };
}
