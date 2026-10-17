/**
 * The rack library's file contract (windsor#862, record `2026-10-17-racks`
 * decisions 6 to 8): one `racks/<id>.json` per rack, a part's sound with
 * the song-specific state left out, read by the console and the tests
 * through the same loader, so a file the console writes is exactly a file
 * it loads back into a part.
 *
 * A file is
 *
 *     { "format": 1, "kind": "rack", "name", "category", "tags": [],
 *       "description", "patchFormat": 4, "patch": { … }, "patchSource"?,
 *       "lowCut"?, "sequencer"?: { "kind", … }, "inserts": [ … ] }
 *
 * - `format` is the rack file format and `patchFormat` the embedded patch's
 *   (`rackMigrations.ts`); either one this build cannot bring to its own is
 *   refused with a `RackFormatError`.
 * - `kind` is always `rack`; a file without one is a patch file.
 * - `id` is the filename slug, immutable; `name` is the display name and
 *   equals `patch.name`, as a patch file's does.
 * - `patch` is checked by the patch loader's own rules: a missing key fills
 *   from `makePatch()`, an unknown key or a wrong-typed leaf refuses.
 * - `inserts` is the strip's chain, read by the insert normaliser: a missing
 *   field fills from its kind's defaults, a clamp or a dropped key is a
 *   problem the entry lists, and a kind the registry lacks refuses the file.
 *   A compressor or Pump keyed from a slot refuses it too: a rack names no
 *   part (decision 3). Insert ids travel with the rack (decision 4).
 * - `lowCut` is the strip's, in Hz within its range, or absent.
 * - `sequencer` is a whole spec without `seed`, read as a region's pattern
 *   is: a `seed` inside it is dropped silently, and a kind this build lacks
 *   refuses the file.
 *
 * Browser-safe: no Node, no DOM.
 */
import { LOW_CUT_MAX_HZ, LOW_CUT_MIN_HZ } from '../audioConstants';
import type { InsertRegistry, InsertSpec } from '../inserts/insertRegistry';
import { INSERT_KINDS, insertSlot, normaliseInserts } from '../inserts/insertRegistry';
import { MAX_INSERTS } from '../inserts/insertConstants';
import { isKeyedSpec } from '../inserts/sidechainSource';
import type { Patch } from '../patch/patch';
import { PATCH_FILE_FORMAT, PATCH_ID_RULE, loadPatchFile } from '../patch/patchLibrary';
import { SEQUENCER_KINDS, type RegionPattern, type SequencerKind } from '../song/arrangement';
import { FieldNormaliser, isRecord, show } from '../song/arrangementFields';
import { normaliseRegionPattern } from '../song/sequencerNormalise';
import {
  RACK_FILE_FORMAT,
  RACK_FILE_KIND,
  RACK_FILE_OPTIONAL,
  RACK_FILE_REQUIRED,
} from './rackConstants';
import { RackFormatError, upgradeRackFile } from './rackMigrations';

export { RACK_FILE_FORMAT, RACK_FILE_KIND };

export interface RackFile {
  format: number;
  kind: typeof RACK_FILE_KIND;
  name: string;
  category: string;
  tags: string[];
  description: string;
  patchFormat: number;
  patch: Patch;
  /** The library patch id the patch came from; provenance only. */
  patchSource?: string;
  /** The strip's low cut in Hz; absent leaves the loaded part's. */
  lowCut?: number;
  /** The part's sequencer without its seed; absent leaves the loaded part's. */
  sequencer?: RegionPattern;
  /** The strip's chain, in signal order, each with its id. */
  inserts: InsertSpec[];
}

/** A loaded file, its patch completed and its chain normalised, plus the id its filename gave it. */
export interface RackEntry extends RackFile {
  id: string;
  /** What loading corrected without refusing: a clamped number, a dropped unknown key. */
  problems: string[];
}

const KNOWN_KEYS: readonly string[] = [...RACK_FILE_REQUIRED, ...RACK_FILE_OPTIONAL];

function refuse(id: string, problems: string[]): never {
  throw new Error(`racks/${id}.json: ${problems.join('; ')}`);
}

/** The keys `raw` has that the contract lacks, and the required ones it lacks, as one line or ''. */
function keyProblems(raw: Record<string, unknown>): string {
  const unknown = Object.keys(raw).filter((key) => !KNOWN_KEYS.includes(key));
  const missing = RACK_FILE_REQUIRED.filter((key) => !Object.hasOwn(raw, key));
  return [
    unknown.length ? `unknown field${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}` : '',
    missing.length ? `missing field${missing.length > 1 ? 's' : ''} ${missing.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

const PATCH_PREFIX = /^patches\/[^:]+\.json: /;

/**
 * The patch section with the rack's own metadata, by the patch loader's
 * rules, so a rack and a patch file agree on every check: the name, the
 * category, the tags, the description, and the patch's keys and leaves.
 * The loader's one error, its file prefix removed, is the problem list.
 */
function patchSection(
  id: string,
  raw: Record<string, unknown>,
): { patch: Patch } | { problems: string[] } {
  const file = {
    format: PATCH_FILE_FORMAT,
    name: raw['name'],
    category: raw['category'],
    tags: raw['tags'],
    description: raw['description'],
    patch: raw['patch'],
  };
  try {
    return { patch: loadPatchFile(id, file).patch };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { problems: error.message.replace(PATCH_PREFIX, '').split('; ') };
  }
}

/** A keyed insert's sidechain when it names a slot, at `at`; '' otherwise. */
function slotKeyProblem(spec: InsertSpec, at: string): string {
  if (!isKeyedSpec(spec)) return '';
  const source = spec.sidechain;
  return isRecord(source) && typeof source.track === 'number'
    ? `${at}.sidechain: keyed from slot ${source.track} — a rack names no part`
    : '';
}

/** The chain: refused for its shape or a dangling kind, kept with its clamps listed otherwise. */
function chainSection(
  raw: unknown,
  registry: InsertRegistry,
): { inserts: InsertSpec[]; notes: string[] } | { problems: string[] } {
  if (!Array.isArray(raw)) return { problems: [`inserts: expected an array, got ${show(raw)}`] };
  if (raw.length > MAX_INSERTS)
    return { problems: [`inserts: length ${raw.length}, at most ${MAX_INSERTS}`] };
  const junk = raw.flatMap((entry, i) =>
    isRecord(entry) ? [] : [`inserts[${i}]: expected an object`],
  );
  if (junk.length) return { problems: junk };
  const n = new FieldNormaliser();
  const inserts = normaliseInserts(raw, 'inserts', n, registry);
  const keyed = inserts.flatMap((spec, i) => {
    const at = `inserts[${i}]`;
    const child = insertSlot(spec);
    return [slotKeyProblem(spec, at), child ? slotKeyProblem(child, `${at}.slot`) : ''];
  });
  const problems = [...n.dangling, ...keyed.filter(Boolean)];
  if (problems.length) return { problems };
  return { inserts, notes: n.corrections };
}

/** The optional sequencer: absent is none; a kind this build lacks or a non-object refuses. */
function sequencerSection(
  raw: unknown,
): { sequencer: RegionPattern | undefined; notes: string[] } | { problems: string[] } {
  if (raw === undefined) return { sequencer: undefined, notes: [] };
  if (!isRecord(raw)) return { problems: [`sequencer: expected an object, got ${show(raw)}`] };
  if (!(SEQUENCER_KINDS as readonly unknown[]).includes(raw.kind))
    return { problems: [`sequencer.kind: no sequencer kind ${show(raw.kind)} is defined`] };
  const n = new FieldNormaliser();
  const sequencer = normaliseRegionPattern(raw, raw.kind as SequencerKind, 'sequencer', n);
  return { sequencer, notes: n.corrections };
}

/** The optional low cut: absent is none; anything but a number in the strip's range refuses. */
function lowCutProblem(raw: unknown): string {
  if (raw === undefined) return '';
  const ok =
    typeof raw === 'number' &&
    Number.isFinite(raw) &&
    raw >= LOW_CUT_MIN_HZ &&
    raw <= LOW_CUT_MAX_HZ;
  return ok
    ? ''
    : `lowCut: expected a number ${LOW_CUT_MIN_HZ}–${LOW_CUT_MAX_HZ} Hz, got ${show(raw)}`;
}

/** The optional patch provenance: absent is none; anything but a slug refuses. */
function patchSourceProblem(raw: unknown): string {
  if (raw === undefined) return '';
  return typeof raw === 'string' && PATCH_ID_RULE.test(raw)
    ? ''
    : `patchSource: expected a patch id slug, got ${show(raw)}`;
}

/**
 * Loads one file against the contract above: upgraded to this build's
 * formats, checked, and returned with its patch completed and its chain
 * normalised. Throws one error naming the file and every problem found, or
 * a `RackFormatError` when a format is one this build cannot read.
 */
export function loadRackFile(
  id: string,
  raw: unknown,
  registry: InsertRegistry = INSERT_KINDS,
): RackEntry {
  const fail = (problems: string[]): never => refuse(id, problems);
  if (!PATCH_ID_RULE.test(id))
    fail([`id "${id}" is not a slug (lower-case letters, digits and single hyphens)`]);
  if (!isRecord(raw)) return fail(['expected a JSON object']);
  if (raw['kind'] !== RACK_FILE_KIND)
    return fail([`kind: expected "${RACK_FILE_KIND}", got ${show(raw['kind'])}`]);
  const upgraded = upgradeRackFile(raw);
  if ('refused' in upgraded) throw new RackFormatError(id, upgraded.refused);
  return loadCurrentFile(id, upgraded.value as Record<string, unknown>, registry);
}

/** A file at this build's formats against the contract. */
function loadCurrentFile(
  id: string,
  raw: Record<string, unknown>,
  registry: InsertRegistry,
): RackEntry {
  const fail = (problems: string[]): never => refuse(id, problems);
  const keys = keyProblems(raw);
  if (keys) fail([keys]);
  const problems: string[] = [];
  if (raw['format'] !== RACK_FILE_FORMAT)
    problems.push(`format: expected ${RACK_FILE_FORMAT}, got ${show(raw['format'])}`);
  if (raw['patchFormat'] !== PATCH_FILE_FORMAT)
    problems.push(`patchFormat: expected ${PATCH_FILE_FORMAT}, got ${show(raw['patchFormat'])}`);
  const patch = patchSection(id, raw);
  if ('problems' in patch) problems.push(...patch.problems);
  problems.push(patchSourceProblem(raw['patchSource']), lowCutProblem(raw['lowCut']));
  const chain = chainSection(raw['inserts'], registry);
  if ('problems' in chain) problems.push(...chain.problems);
  const sequencer = sequencerSection(raw['sequencer']);
  if ('problems' in sequencer) problems.push(...sequencer.problems);
  const hard = problems.filter(Boolean);
  if (hard.length || 'problems' in patch || 'problems' in chain || 'problems' in sequencer)
    return fail(hard);
  return {
    id,
    format: RACK_FILE_FORMAT,
    kind: RACK_FILE_KIND,
    name: raw['name'] as string,
    category: raw['category'] as string,
    tags: [...(raw['tags'] as string[])],
    description: raw['description'] as string,
    patchFormat: PATCH_FILE_FORMAT,
    patch: patch.patch,
    ...(raw['patchSource'] !== undefined && { patchSource: raw['patchSource'] as string }),
    ...(raw['lowCut'] !== undefined && { lowCut: raw['lowCut'] as number }),
    ...(sequencer.sequencer !== undefined && { sequencer: sequencer.sequencer }),
    inserts: chain.inserts,
    problems: [...chain.notes, ...sequencer.notes],
  };
}
