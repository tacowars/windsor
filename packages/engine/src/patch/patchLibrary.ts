/**
 * The patch library's file contract (#561, epic #564): one
 * `patches/<id>.json` per patch, read by the game, the standalone editor and
 * the tests through the same validator, so a file the editor writes is exactly
 * a file the game plays.
 *
 * A file is
 *
 *     { "format": 1, "name", "category", "tags": [], "description",
 *       "patch": { …full normalised Patch… },
 *       "headroom": { "worstSeed", "peak", "seedsSwept", "contentHash" } }
 *
 * - `id` is the filename slug, immutable; `name` is the editable display name
 *   and equals `patch.name` (epic decision 4).
 * - `patch` is a complete `Patch` exactly as `makePatch` would return it —
 *   every field present, nothing extra, numbers at full double precision.
 * - `headroom` is the offline clip sweep's record: the seed that produced the
 *   worst peak, that peak, how many seeds were swept, and a hash of `patch` so
 *   an edited patch cannot ride on a stale sweep. `fmProcessorHeadroom.test.ts`
 *   renders the recorded seed; `packages/app/sweep-headroom.mjs` writes
 *   the record. Decision record: `docs/log/2026-09-15-561-patch-library-file-shape.md`.
 *
 * Browser-safe: no Node, no DOM. `presets.ts` builds the whole-bank table from
 * the generated `patches/index.ts`; `gameplayPatches.ts` reads single files by
 * id so a bundler can drop the rest once #562 removes the runtime fallback.
 */
import type { Patch } from './patch';
import { makePatch } from './patch';

export const PATCH_FILE_FORMAT = 1;

/** The offline sweep that writes a file's `headroom` record; error messages quote it. */
export const SWEEP_COMMAND = 'node packages/app/sweep-headroom.mjs';

/** A filename slug: lower-case words of letters and digits joined by single hyphens. */
export const PATCH_ID_RULE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface HeadroomRecord {
  worstSeed: number;
  peak: number;
  seedsSwept: number;
  contentHash: string;
}

export interface PatchFile {
  format: number;
  name: string;
  category: string;
  tags: string[];
  description: string;
  patch: Patch;
  headroom: HeadroomRecord;
}

/** A validated file plus the id its filename gave it. */
export interface LibraryEntry extends PatchFile {
  id: string;
}

const FILE_KEYS = ['format', 'name', 'category', 'tags', 'description', 'patch', 'headroom'];
/** A missing `headroom` is reported by `headroomProblems`, with the command that writes it. */
const REQUIRED_KEYS = FILE_KEYS.filter((key) => key !== 'headroom');
const HEADROOM_KEYS = ['worstSeed', 'peak', 'seedsSwept', 'contentHash'];

/** `String(-0)` is `'0'`; the one value `Object.is` distinguishes gets its own spelling. */
const show = (value: unknown): string => (Object.is(value, -0) ? '-0' : String(value));

/**
 * Every leaf where `actual` is not `Object.is`-identical to `expected`, by
 * path, with key sets and array lengths compared on the way down. `toEqual`
 * would pass `-0` for `0` and hide a one-ulp drift only by accident.
 */
export function patchLeafDifferences(actual: unknown, expected: unknown, path = ''): string[] {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected an array`];
    if (actual.length !== expected.length)
      return [`${path}: length ${actual.length}, expected ${expected.length}`];
    return expected.flatMap((item, i) => patchLeafDifferences(actual[i], item, `${path}[${i}]`));
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual))
      return [`${path}: expected an object`];
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    if (actualKeys.join(',') !== expectedKeys.join(','))
      return [`${path}: keys ${actualKeys.join(',')} ≠ ${expectedKeys.join(',')}`];
    return expectedKeys.flatMap((key) =>
      patchLeafDifferences(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        `${path}.${key}`,
      ),
    );
  }
  return Object.is(actual, expected) ? [] : [`${path}: ${show(actual)} ≠ ${show(expected)}`];
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HEX = 16;
const HASH_DIGITS = 8;

/** JSON with every object's keys sorted, so key order never changes a hash. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const body = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${body.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 32-bit FNV-1a of the normalised patch's key-sorted JSON, as eight hex
 * digits. A staleness detector for the headroom record, not a security hash:
 * it has to run synchronously in the browser at load and in Node in the
 * sweep, and both must agree. Normalising and sorting first means the same
 * patch hashes the same whichever writer produced the file.
 */
export function patchContentHash(patch: Patch): string {
  const text = canonicalJson(makePatch(patch));
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(HEX).padStart(HASH_DIGITS, '0');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function keyDifference(
  actual: Record<string, unknown>,
  expected: readonly string[],
  required: readonly string[] = expected,
): string {
  const unknown = Object.keys(actual).filter((key) => !expected.includes(key));
  const missing = required.filter((key) => !Object.hasOwn(actual, key));
  return [
    unknown.length ? `unknown field${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}` : '',
    missing.length ? `missing field${missing.length > 1 ? 's' : ''} ${missing.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * The patch section against `makePatch`: same keys at every level, same leaf
 * types, and the normalised copy identical to the file — so a file that was
 * not written by the normaliser (an extra field, a string for a number, a
 * missing envelope) is refused rather than half-read.
 */
function patchProblems(raw: unknown): string[] {
  if (!isRecord(raw)) return ['patch: expected an object'];
  // Keys and types against the default patch (never against makePatch(raw),
  // which would carry an unknown field straight through), then values
  // against the normalised copy.
  const shape = shapeDifferences(raw, makePatch(), 'patch');
  if (shape.length) return shape;
  const normalised = makePatch(raw as unknown as Patch);
  return patchLeafDifferences(raw, normalised, 'patch').map((line) => `${line} after makePatch`);
}

/** Keys and leaf types of `actual` against the normalised `template`, by path. */
function shapeDifferences(actual: unknown, template: unknown, path: string): string[] {
  if (Array.isArray(template)) {
    if (!Array.isArray(actual)) return [`${path}: expected an array`];
    return template.flatMap((item, i) => shapeDifferences(actual[i], item, `${path}[${i}]`));
  }
  if (isRecord(template)) {
    if (!isRecord(actual)) return [`${path}: expected an object`];
    const keys = keyDifference(actual, Object.keys(template));
    if (keys) return [`${path}: ${keys}`];
    return Object.keys(template).flatMap((key) =>
      shapeDifferences(actual[key], template[key], `${path}.${key}`),
    );
  }
  // `userPartials` is `number[] | null`: the template's null admits either.
  if (template === null) {
    if (actual === null || (Array.isArray(actual) && actual.every(Number.isFinite))) return [];
    return [`${path}: expected null or a number array`];
  }
  if (typeof actual !== typeof template)
    return [`${path}: expected a ${typeof template}, got ${show(actual)}`];
  if (typeof actual === 'number' && !Number.isFinite(actual))
    return [`${path}: expected a finite number, got ${show(actual)}`];
  return [];
}

function headroomProblems(raw: unknown, patch: Patch, id: string): string[] {
  const fix = `run \`${SWEEP_COMMAND} ${id}\``;
  if (raw === undefined) return [`missing headroom record — ${fix}`];
  if (!isRecord(raw)) return ['headroom: expected an object'];
  const keys = keyDifference(raw, HEADROOM_KEYS);
  if (keys) return [`headroom: ${keys}`];
  const problems: string[] = [];
  for (const key of ['worstSeed', 'peak', 'seedsSwept']) {
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]))
      problems.push(`headroom.${key}: expected a finite number`);
  }
  if (typeof raw['contentHash'] !== 'string')
    problems.push('headroom.contentHash: expected a string');
  if (problems.length) return problems;
  if (raw['contentHash'] !== patchContentHash(patch))
    return [`stale headroom record: the patch changed since its sweep — ${fix}`];
  return [];
}

function metadataProblems(raw: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (raw['format'] !== PATCH_FILE_FORMAT)
    problems.push(`format: expected ${PATCH_FILE_FORMAT}, got ${show(raw['format'])}`);
  for (const key of ['name', 'category', 'description']) {
    if (typeof raw[key] !== 'string') problems.push(`${key}: expected a string`);
  }
  if (typeof raw['name'] === 'string' && !raw['name'].trim()) problems.push('name: empty');
  if (typeof raw['category'] === 'string' && !raw['category'].trim())
    problems.push('category: empty');
  const tags = raw['tags'];
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string' && tag.trim()))
    problems.push('tags: expected an array of non-empty strings');
  return problems;
}

function refuse(id: string, problems: string[]): never {
  throw new Error(`patches/${id}.json: ${problems.join('; ')}`);
}

/**
 * Validates one file against the contract above and returns it typed, or
 * throws one error naming the file and every problem found.
 */
export function loadPatchFile(id: string, raw: unknown): LibraryEntry {
  const entry = validatePatchFile(id, raw);
  const headroom = headroomProblems(entry.headroom, entry.patch, id);
  if (headroom.length) refuse(id, headroom);
  return entry as LibraryEntry;
}

/** A validated file whose sweep has not run yet: the record is absent or stale. */
export type UnsweptLibraryEntry = Omit<LibraryEntry, 'headroom'> & { headroom?: HeadroomRecord };

/**
 * The editor's re-read after a write (#563): every check `loadPatchFile`
 * makes except the sweep's currency — a missing record is accepted, a stale
 * one is carried as written, a malformed one is still refused. The game and
 * the tests never use this; `npm run verify` stays the gate that demands the
 * sweep.
 */
export function loadUnsweptPatchFile(id: string, raw: unknown): UnsweptLibraryEntry {
  const entry = validatePatchFile(id, raw);
  if (entry.headroom !== undefined) {
    const problems = headroomProblems(entry.headroom, entry.patch, id).filter(
      (problem) => !problem.startsWith('stale headroom record'),
    );
    if (problems.length) refuse(id, problems);
  }
  return entry;
}

/** Everything but the headroom record's currency; the record itself is returned as found. */
function validatePatchFile(id: string, raw: unknown): UnsweptLibraryEntry {
  const fail = (problems: string[]): never => refuse(id, problems);
  if (!PATCH_ID_RULE.test(id))
    fail([`id "${id}" is not a slug (lower-case letters, digits and single hyphens)`]);
  if (!isRecord(raw)) return fail(['expected a JSON object']);
  const keys = keyDifference(raw, FILE_KEYS, REQUIRED_KEYS);
  if (keys) fail([keys]);
  const problems = [...metadataProblems(raw), ...patchProblems(raw['patch'])];
  if (problems.length) fail(problems);
  const patch = raw['patch'] as Patch;
  if (raw['name'] !== patch.name)
    fail([`name "${show(raw['name'])}" ≠ patch.name "${patch.name}"`]);
  return { id, ...(raw as unknown as Omit<UnsweptLibraryEntry, 'id'>) };
}

/** Every file of a `{ id: raw }` map, validated, keyed by id. */
export function loadPatchLibrary(
  files: Readonly<Record<string, unknown>>,
): Record<string, LibraryEntry> {
  return Object.fromEntries(Object.entries(files).map(([id, raw]) => [id, loadPatchFile(id, raw)]));
}
