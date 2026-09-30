/**
 * Every insert's identity (windsor#186): a short string, unique within its
 * chain, carried on the insert entry in the song, so undo, redo, import,
 * export and a move all keep it with the insert. The engine never reads it
 * for sound: no stage sees it, and a list that only adds or changes ids is
 * param writes to the same stages (`insertChain.ts`).
 *
 * One generator makes every id. Seeded, it is deterministic, so a test can
 * pin it; the shared source the console adds with is seeded at random.
 *
 * Normalising fills an id where an entry has none, silently, since a song
 * written before ids is not wrong. A duplicate within a chain, or anything
 * that is not a non-empty string, is replaced with a correction. The fill is
 * a pure function of the chain: its seed is a hash of the chain's kinds in
 * order, so the same document always reads back with the same ids, a knob
 * edit to an insert without one fills the id it would have had, and chains
 * of other kinds seldom share one.
 */
import { FieldNormaliser, show } from '../song/arrangementFields';
import type { InsertSpec } from './insertRegistry';
import {
  FNV_OFFSET_BASIS,
  FNV_PRIME,
  INSERT_ID_ALPHABET,
  INSERT_ID_LENGTH,
  MULBERRY_INCREMENT,
  MULBERRY_ODD,
  MULBERRY_SHIFT_A,
  MULBERRY_SHIFT_B,
  MULBERRY_SHIFT_C,
  UINT32_RANGE,
} from './insertIdConstants';

/** Where fresh ids come from. */
export interface InsertIdSource {
  /** A fresh id that `taken` does not hold. */
  next(taken?: Iterable<string>): string;
}

/** Whether `value` can be an insert's id: a non-empty string. */
export const isInsertId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** A 32-bit seed from `text` (FNV-1a). */
export function seedFromText(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME);
  }
  return hash >>> 0;
}

/** The id generator: deterministic from `seed`, or seeded at random without one. */
export function createInsertIdSource(
  seed: number = Math.floor(Math.random() * UINT32_RANGE),
): InsertIdSource {
  let state = seed >>> 0;
  const draw = (): number => {
    state = (state + MULBERRY_INCREMENT) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> MULBERRY_SHIFT_A), t | 1);
    t ^= t + Math.imul(t ^ (t >>> MULBERRY_SHIFT_B), t | MULBERRY_ODD);
    return (t ^ (t >>> MULBERRY_SHIFT_C)) >>> 0;
  };
  const one = (): string => {
    let id = '';
    for (let i = 0; i < INSERT_ID_LENGTH; i++) {
      id += INSERT_ID_ALPHABET[draw() % INSERT_ID_ALPHABET.length];
    }
    return id;
  };
  return {
    next(taken: Iterable<string> = []): string {
      const used = new Set(taken);
      let id = one();
      while (used.has(id)) id = one();
      return id;
    },
  };
}

/** The shared source the console's fresh inserts draw from. */
const FRESH = createInsertIdSource();

/** A fresh id for an insert joining a chain whose ids are `taken`. */
export const freshInsertId = (taken: Iterable<string> = []): string => FRESH.next(taken);

/** One kept entry of a chain, as `chainIds` reads it. */
export interface IdClaim {
  /** The entry's `id` as the document held it. */
  readonly raw: unknown;
  /** The entry's path, for a correction. */
  readonly at: string;
  /** The entry's kind: the chain's kinds seed the ids it fills. */
  readonly kind: string;
}

/**
 * The ids of a chain's entries, in order. A valid id is kept the first time
 * the chain holds it; a later duplicate, and anything that is not an id, is
 * replaced with a correction; an absent one is filled silently. Every filled
 * id is drawn after the kept ones are known, so it never takes one of them.
 */
export function chainIds(claims: readonly IdClaim[], n: FieldNormaliser): string[] {
  const taken = new Set<string>();
  const ids: (string | undefined)[] = claims.map(({ raw, at }) => {
    if (raw === undefined) return undefined;
    if (!isInsertId(raw)) {
      n.correction(`${at}.id: ${show(raw)} is not an id — a new one`);
      return undefined;
    }
    if (taken.has(raw)) {
      n.correction(`${at}.id: ${show(raw)} is already in this chain — a new one`);
      return undefined;
    }
    taken.add(raw);
    return raw;
  });
  const fill = createInsertIdSource(seedFromText(claims.map((claim) => claim.kind).join()));
  return ids.map((id) => {
    if (id !== undefined) return id;
    const fresh = fill.next(taken);
    taken.add(fresh);
    return fresh;
  });
}

/**
 * `list` with the ids normalising would give it: every insert keeps a valid
 * id and one without is filled, exactly as `normaliseInserts` fills it. For a
 * chain the code holds rather than the song (a send bus's default chain),
 * so the console keys and extends it with the ids it will have once saved.
 */
export function withInsertIds(list: readonly InsertSpec[]): InsertSpec[] {
  const ids = chainIds(
    list.map((spec, i) => ({ raw: spec.id, at: String(i), kind: spec.kind })),
    new FieldNormaliser(),
  );
  return list.map((spec, i) => (spec.id === ids[i] ? spec : { ...spec, id: ids[i]! }));
}
