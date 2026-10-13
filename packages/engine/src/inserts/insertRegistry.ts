/**
 * The insert kinds (#641): code-owned, the way `RETURNS` is. A song's strip
 * lists which of these it uses and how they are set, up to `MAX_INSERTS`; a
 * kind the code does not define is dangling, never invented, so no DSP runs
 * that a table here did not declare. A new kind is one file under `inserts/`,
 * its constants, its `InsertSpec` member and an appended entry below.
 */
import type { FieldNormaliser } from '../song/arrangementFields';
import { isRecord, show } from '../song/arrangementFields';
import { COMPRESSOR_INSERT, type CompressorSpec } from './compressorInsert';
import type { ChorusSpec } from './chorusInsert';
import { CHORUS_INSERT } from './chorusInsert';
import type { DriveSpec } from './driveInsert';
import { DRIVE_INSERT } from './driveInsert';
import { ADVANCED_DRIVE_INSERT } from './advancedDriveInsert';
import type { AdvancedDriveSpec } from './advancedDriveSpec';
import { MAX_INSERTS } from './insertConstants';
import { RETRO_REVERB_INSERT } from './retroReverbInsert';
import { DELAY_INSERT } from './delayInsert';
import type { DelaySpec } from './delaySpec';
import { TAPE_INSERT } from './tapeInsert';
import type { TapeSpec } from './tapeSpec';
import { PHASER_INSERT } from './phaserInsert';
import type { PhaserSpec } from './phaserSpec';
import { ENSEMBLE_INSERT } from './ensembleInsert';
import type { EnsembleSpec } from './ensembleSpec';
import type { RetroReverbSpec } from './retroReverbSpec';
import { REVERB_INSERT } from './reverbInsert';
import type { ReverbInsertSpec } from './reverbInsert';
import { ECHO_INSERT } from './echoInsert';
import type { EchoSpec } from './echoInsert';
import { EQ_INSERT } from './eqInsert';
import type { EqSpec } from './eqSpec';
import { FILTER_INSERT } from './filterInsert';
import type { FilterSpec } from './filterSpec';
import { BLOOM_INSERT } from './bloomInsert';
import { PUMP_INSERT } from './pumpInsert';
import type { PumpSpec } from './pumpSpec';
import { isKeyedSpec } from './sidechainSource';
import type { BloomSpec } from './bloomSpec';
import type { InsertKind, InsertStage, WetPath } from './insertKind';
import type { IdClaim } from './insertIds';
import { chainIds } from './insertIds';

/**
 * An insert's identity in its chain (windsor#186, `insertIds.ts`). A
 * normalised list gives every entry one; a spec built in code may leave it
 * out until it is normalised or added to a chain.
 */
export interface InsertIdentity {
  readonly id?: string;
}

/** Every kind's settings, discriminated on `kind`, with the insert's identity. */
export type InsertSpec = (
  | AdvancedDriveSpec
  | DriveSpec
  | ChorusSpec
  | CompressorSpec
  | RetroReverbSpec
  | TapeSpec
  | PhaserSpec
  | DelaySpec
  | EnsembleSpec
  | ReverbInsertSpec
  | EchoSpec
  | EqSpec
  | FilterSpec
  | BloomSpec
  | PumpSpec
) &
  InsertIdentity;
export type InsertKindName = InsertSpec['kind'];

/** A registry of kinds by name. The strip takes one as a parameter, so a test can inject another. */
export type InsertRegistry = Readonly<Record<string, InsertKind<InsertSpec>>>;

export const INSERT_KINDS: Readonly<Record<InsertKindName, InsertKind<InsertSpec>>> = {
  drive: DRIVE_INSERT,
  'advanced-drive': ADVANCED_DRIVE_INSERT,
  chorus: CHORUS_INSERT,
  compressor: COMPRESSOR_INSERT,
  'retro-reverb': RETRO_REVERB_INSERT,
  phaser: PHASER_INSERT,
  delay: DELAY_INSERT,
  ensemble: ENSEMBLE_INSERT,
  tape: TAPE_INSERT,
  reverb: REVERB_INSERT,
  echo: ECHO_INSERT,
  eq: EQ_INSERT,
  filter: FILTER_INSERT,
  bloom: BLOOM_INSERT,
  pump: PUMP_INSERT,
};

export const INSERT_KIND_NAMES = Object.keys(INSERT_KINDS) as InsertKindName[];

/** The registry's entry for `kind`, own properties only (an inherited name is not a kind). */
export function insertKind(
  registry: InsertRegistry,
  kind: unknown,
): InsertKind<InsertSpec> | undefined {
  return typeof kind === 'string' && Object.hasOwn(registry, kind) ? registry[kind] : undefined;
}

/** The field a host kind keeps its child in (record `2026-10-11-wet-path-slot`). */
export const SLOT_FIELD = 'slot';

/** Whether `kind` is a host: its `fields` include `slot`, one child insert on its wet path. */
export const isHostKind = (kind: InsertKind<InsertSpec>): boolean =>
  kind.fields.includes(SLOT_FIELD);

/** The child in `spec`'s slot, or null when it holds none or is not a host's. */
export function insertSlot(spec: InsertSpec): InsertSpec | null {
  return (SLOT_FIELD in spec ? spec.slot : null) ?? null;
}

/**
 * A strip's `inserts` list: absent is `[]`; a junk entry is dropped with a
 * correction; a kind the registry lacks is dangling and dropped; entries past
 * `MAX_INSERTS` are dropped with a correction; each kept entry is its kind's
 * normalised spec with its `id`. The id is read here, beside the kind's own
 * fields rather than among them, and filled or replaced as `chainIds` says.
 * A host's child is part of its host's entry and counts toward nothing.
 */
export function normaliseInserts(
  raw: unknown,
  path: string,
  n: FieldNormaliser,
  registry: InsertRegistry = INSERT_KINDS,
): InsertSpec[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list — using none`);
    return [];
  }
  const out: InsertSpec[] = [];
  const claims: IdClaim[] = [];
  raw.forEach((entry: unknown, i) => {
    const at = `${path}[${i}]`;
    // Past the limit, only an entry that would be kept is reported as over it.
    if (out.length >= MAX_INSERTS && isRecord(entry) && insertKind(registry, entry.kind)) {
      n.correction(`${at}: past the ${MAX_INSERTS}-insert limit — dropped`);
      return;
    }
    const spec = normaliseInsertEntry(entry, at, n, registry);
    if (!spec || !isRecord(entry)) return;
    out.push(spec);
    claims.push({ raw: entry.id, at, kind: spec.kind });
  });
  const ids = chainIds(claims, n);
  return out.map((spec, i) => ({ ...spec, id: ids[i]! }));
}

/**
 * One insert entry at `at`, its `id` apart: its kind's normalised spec, or
 * undefined (reported) for a junk entry or a dangling kind. A host's `slot`
 * is read here, never by its kind (`normaliseSlot`).
 */
export function normaliseInsertEntry(
  entry: unknown,
  at: string,
  n: FieldNormaliser,
  registry: InsertRegistry = INSERT_KINDS,
): InsertSpec | undefined {
  if (!isRecord(entry)) {
    n.correction(`${at}: ${show(entry)} is not an insert — dropped`);
    return undefined;
  }
  const kind = insertKind(registry, entry.kind);
  if (!kind) {
    n.dangling.push(`${at}.kind: no insert kind ${show(entry.kind)} is defined`);
    n.correction(`${at}: dropped`);
    return undefined;
  }
  const fields: Record<string, unknown> = { ...entry };
  delete fields.id;
  if (!isHostKind(kind)) return kind.normalise(fields, at, n);
  const child = fields[SLOT_FIELD];
  delete fields[SLOT_FIELD];
  const spec = kind.normalise(fields, at, n);
  const slot = normaliseSlot(child, spec.kind, `${at}.${SLOT_FIELD}`, n, registry);
  // A host's spec is one whose type carries `slot`.
  return { ...spec, [SLOT_FIELD]: slot } as InsertSpec;
}

/**
 * A host's child at `path`: absent or null is none, silently; junk, the
 * host's own kind and a dangling kind are none, reported. A kept child is
 * its kind's spec with an id of its own, from a one-entry chain, which may
 * equal any strip id: every target spells it under its host's. One level
 * deep, so a host child's own slot is none, and within the v1 limits
 * (`slotLimits`).
 */
function normaliseSlot(
  raw: unknown,
  host: string,
  path: string,
  n: FieldNormaliser,
  registry: InsertRegistry,
): InsertSpec | null {
  if (raw === undefined || raw === null) return null;
  if (isRecord(raw) && raw.kind === host) {
    n.correction(`${path}: a ${host} cannot hold another ${host} — using none`);
    return null;
  }
  const entry = isRecord(raw) ? withoutNestedSlot(raw, path, n, registry) : raw;
  const spec = normaliseInsertEntry(entry, path, n, registry);
  if (!spec || !isRecord(raw)) return null;
  const [id] = chainIds([{ raw: raw.id, at: path, kind: spec.kind }], n);
  return { ...slotLimits(spec, path, n), id: id! };
}

/** `raw` with its own slot emptied, reported, when it is a host holding one. */
function withoutNestedSlot(
  raw: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
  registry: InsertRegistry,
): Record<string, unknown> {
  const kind = insertKind(registry, raw.kind);
  const nested = raw[SLOT_FIELD];
  if (!kind || !isHostKind(kind) || nested === undefined || nested === null) return raw;
  n.correction(`${path}.${SLOT_FIELD}: an insert in a slot holds no slot of its own — using none`);
  return { ...raw, [SLOT_FIELD]: null };
}

/** The v1 slot limits (epic decision 8): a child that keys from a sidechain listens to its own input. */
function slotLimits(spec: InsertSpec, path: string, n: FieldNormaliser): InsertSpec {
  if (!isKeyedSpec(spec) || (spec.sidechain ?? 'internal') === 'internal') return spec;
  n.correction(`${path}.sidechain: ${show(spec.sidechain)} in a slot — set to "internal"`);
  return { ...spec, sidechain: 'internal' };
}

export type { InsertKind, InsertStage, WetPath };
