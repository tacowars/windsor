/**
 * Patch format upgrades (record `2026-09-28-format-versions-refuse-never-destroy`).
 *
 * A patch file carries `format` (`PATCH_FILE_FORMAT`); a file with none is
 * format 1, so every file written before the field was checked stays valid.
 * `PATCH_MIGRATIONS[n]` upgrades a patch at format `n` to `n + 1`, and runs
 * before the loader's check. A PR that bumps the format may add one, or leave
 * none and let the refusal apply: a file the chain cannot bring to this
 * build's format is refused with a `PatchFormatError`, which the console
 * lists as "old format" and keeps.
 *
 * An upgrade takes the patch object itself (the sound data), so the same
 * table serves a library file's `patch` and a song's embedded snapshot.
 */
import type { FormatRefusal, MigrationTable } from '../song/formatUpgrade';
import { declaredVersion, formatRefusal, runUpgrades } from '../song/formatUpgrade';

/** The patch file format this build reads and writes (#561). */
export const PATCH_FILE_FORMAT = 1;

/** The format of a file that declares none: every file written before the check. */
export const PATCH_FORMAT_ABSENT = 1;

type RawPatch = Record<string, unknown>;

/** Empty: format 1 is the only format there has been. */
export const PATCH_MIGRATIONS: MigrationTable<RawPatch> = {};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A patch file refused for its format; the message names the file, the format found and the one read. */
export class PatchFormatError extends Error {
  constructor(
    readonly id: string,
    readonly refusal: FormatRefusal,
  ) {
    super(`patches/${id}.json: ${refusal.message}`);
    this.name = 'PatchFormatError';
  }
}

export type PatchUpgrade<T> = { readonly value: T } | { readonly refused: FormatRefusal };

/**
 * One patch object at a declared format, upgraded to this build's, or the
 * refusal. A format that is not an integer is left for the validator.
 */
export function upgradePatch(
  patch: RawPatch,
  format: unknown,
  migrations: MigrationTable<RawPatch> = PATCH_MIGRATIONS,
): PatchUpgrade<RawPatch> {
  const from = declaredVersion(format, PATCH_FORMAT_ABSENT);
  if (from === null) return { value: patch };
  const { value, version } = runUpgrades(patch, from, PATCH_FILE_FORMAT, migrations);
  if (version !== PATCH_FILE_FORMAT)
    return { refused: formatRefusal('patch', from, PATCH_FILE_FORMAT) };
  return { value };
}

/**
 * A raw `patches/<id>.json` upgraded to this build's format, with `format`
 * written in; anything that is not a file with an integer format is returned
 * as it came, for the validator to report.
 */
export function upgradePatchFile(
  raw: unknown,
  migrations: MigrationTable<RawPatch> = PATCH_MIGRATIONS,
): PatchUpgrade<unknown> {
  if (!isRecord(raw) || declaredVersion(raw['format'], PATCH_FORMAT_ABSENT) === null)
    return { value: raw };
  const patch = isRecord(raw['patch']) ? raw['patch'] : {};
  const upgraded = upgradePatch(patch, raw['format'], migrations);
  if ('refused' in upgraded) return upgraded;
  const file: Record<string, unknown> = { ...raw, format: PATCH_FILE_FORMAT };
  if (isRecord(raw['patch'])) file['patch'] = upgraded.value;
  return { value: file };
}
