/**
 * The patch library's file contract (#561, epic #564): one
 * `patches/<id>.json` per patch, read by the console and the tests through
 * the same loader, so a file the editor writes is exactly a file a song
 * plays.
 *
 * A file is
 *
 *     { "format": 2, "name", "category", "tags": [], "description",
 *       "patch": { …normalised Patch… } }
 *
 * - `format` is the file format (`patchMigrations.ts`): a file with none is
 *   format 1, one an upgrade reaches is upgraded on load, and any other is
 *   refused with a `PatchFormatError` (record
 *   `2026-09-28-format-versions-refuse-never-destroy`).
 * - `id` is the filename slug, immutable; `name` is the editable display name
 *   and equals `patch.name` (epic decision 4).
 * - `patch` is a `Patch` as `makePatch` returns it, numbers at full double
 *   precision. A key `makePatch` fills may be missing, and the loader returns
 *   the patch completed, so a field added with a default costs no rewrite of
 *   the bank. A key it does not know, at any level, and a leaf of the wrong
 *   type are refused (record `2026-09-28-retire-the-headroom-record`).
 *
 * Browser-safe: no Node, no DOM. `presets.ts` builds the whole-bank table from
 * the generated `patches/index.ts`; `fallbackPatch.ts` reads its single file
 * by id, so the playback path needs none of the rest.
 */
import type { PartialPatch, Patch } from './patch';
import { makePatch } from './patch';
import { PATCH_FILE_FORMAT, PatchFormatError, upgradePatchFile } from './patchMigrations';

export { PATCH_FILE_FORMAT };

/** A filename slug: lower-case words of letters and digits joined by single hyphens. */
export const PATCH_ID_RULE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface PatchFile {
  format: number;
  name: string;
  category: string;
  tags: string[];
  description: string;
  patch: Patch;
}

/** A loaded file, its patch completed, plus the id its filename gave it. */
export interface LibraryEntry extends PatchFile {
  id: string;
}

const FILE_KEYS = ['format', 'name', 'category', 'tags', 'description', 'patch'];

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
 * The patch section against the default patch: no key it does not know at
 * any level, each present leaf of the template's type, and each array the
 * template's length (four operators, four LFO depths). A missing key is not
 * a problem: `makePatch` fills it. Never checked against `makePatch(raw)`,
 * which would carry an unknown field straight through.
 */
function patchProblems(raw: unknown): string[] {
  if (!isRecord(raw)) return ['patch: expected an object'];
  return shapeDifferences(raw, makePatch(), 'patch');
}

/** Keys and leaf types of `actual` against the normalised `template`, by path; absent keys pass. */
function shapeDifferences(actual: unknown, template: unknown, path: string): string[] {
  if (Array.isArray(template)) {
    if (!Array.isArray(actual)) return [`${path}: expected an array`];
    if (actual.length !== template.length)
      return [`${path}: length ${actual.length}, expected ${template.length}`];
    return template.flatMap((item, i) => shapeDifferences(actual[i], item, `${path}[${i}]`));
  }
  if (isRecord(template)) {
    if (!isRecord(actual)) return [`${path}: expected an object`];
    const keys = keyDifference(actual, Object.keys(template), []);
    if (keys) return [`${path}: ${keys}`];
    return Object.keys(actual).flatMap((key) =>
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
 * Loads one file against the contract above: upgraded to this build's
 * format, checked, and returned with its patch completed. Throws one error
 * naming the file and every problem found, or a `PatchFormatError` when the
 * file's format is one this build cannot read. Playback, the tests, the
 * console's folder and its IndexedDB library all read through this.
 */
export function loadPatchFile(id: string, raw: unknown): LibraryEntry {
  const fail = (problems: string[]): never => refuse(id, problems);
  if (!PATCH_ID_RULE.test(id))
    fail([`id "${id}" is not a slug (lower-case letters, digits and single hyphens)`]);
  if (!isRecord(raw)) return fail(['expected a JSON object']);
  // The format first (record `2026-09-28-format-versions-refuse-never-destroy`):
  // upgraded when the chain reaches this build's, refused as its own error
  // otherwise, so the console can keep the file and list it as old.
  const upgraded = upgradePatchFile(raw);
  if ('refused' in upgraded) throw new PatchFormatError(id, upgraded.refused);
  return loadCurrentFile(id, upgraded.value as Record<string, unknown>);
}

/** A file at this build's format against the contract, its patch completed. */
function loadCurrentFile(id: string, raw: Record<string, unknown>): LibraryEntry {
  const fail = (problems: string[]): never => refuse(id, problems);
  const keys = keyDifference(raw, FILE_KEYS);
  if (keys) fail([keys]);
  const problems = [...metadataProblems(raw), ...patchProblems(raw['patch'])];
  if (problems.length) fail(problems);
  const patch = makePatch(raw['patch'] as PartialPatch);
  if (raw['name'] !== patch.name)
    fail([`name "${show(raw['name'])}" ≠ patch.name "${patch.name}"`]);
  return { id, ...(raw as unknown as PatchFile), patch };
}

/** Every file of a `{ id: raw }` map, loaded, keyed by id. */
export function loadPatchLibrary(
  files: Readonly<Record<string, unknown>>,
): Record<string, LibraryEntry> {
  return Object.fromEntries(Object.entries(files).map(([id, raw]) => [id, loadPatchFile(id, raw)]));
}
