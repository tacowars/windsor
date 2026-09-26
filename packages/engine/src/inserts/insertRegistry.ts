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
import { PHASER_INSERT } from './phaserInsert';
import type { PhaserSpec } from './phaserSpec';
import { ENSEMBLE_INSERT } from './ensembleInsert';
import type { EnsembleSpec } from './ensembleSpec';
import type { RetroReverbSpec } from './retroReverbSpec';
import type { InsertKind, InsertStage } from './insertKind';

/** Every kind's settings, discriminated on `kind`. */
export type InsertSpec =
  | AdvancedDriveSpec
  | DriveSpec
  | ChorusSpec
  | CompressorSpec
  | RetroReverbSpec
  | PhaserSpec
  | DelaySpec
  | EnsembleSpec;
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
};

export const INSERT_KIND_NAMES = Object.keys(INSERT_KINDS) as InsertKindName[];

/** The registry's entry for `kind`, own properties only (an inherited name is not a kind). */
export function insertKind(
  registry: InsertRegistry,
  kind: unknown,
): InsertKind<InsertSpec> | undefined {
  return typeof kind === 'string' && Object.hasOwn(registry, kind) ? registry[kind] : undefined;
}

/**
 * A strip's `inserts` list: absent is `[]`; a junk entry is dropped with a
 * correction; a kind the registry lacks is dangling and dropped; entries past
 * `MAX_INSERTS` are dropped with a correction; each kept entry is its kind's
 * normalised spec.
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
  raw.forEach((entry: unknown, i) => {
    const at = `${path}[${i}]`;
    if (!isRecord(entry)) {
      n.correction(`${at}: ${show(entry)} is not an insert — dropped`);
      return;
    }
    const kind = insertKind(registry, entry.kind);
    if (!kind) {
      n.dangling.push(`${at}.kind: no insert kind ${show(entry.kind)} is defined`);
      n.correction(`${at}: dropped`);
      return;
    }
    if (out.length >= MAX_INSERTS) {
      n.correction(`${at}: past the ${MAX_INSERTS}-insert limit — dropped`);
      return;
    }
    out.push(kind.normalise(entry, at, n));
  });
  return out;
}

export type { InsertKind, InsertStage };
