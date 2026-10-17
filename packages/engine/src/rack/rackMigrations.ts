/**
 * Rack format upgrades (windsor#862, record `2026-10-17-racks` decision 7,
 * under `2026-09-28-format-versions-refuse-never-destroy`).
 *
 * A rack file carries two formats: its own `format` (`RACK_FILE_FORMAT`) for
 * the keys around the patch, and `patchFormat` for the embedded patch, which
 * is upgraded through the patch table (`PATCH_MIGRATIONS`) exactly as a
 * song's embedded snapshot is. Either chain failing to reach this build's
 * format refuses the file as a `RackFormatError`, which the console lists as
 * old and keeps. A `format` or `patchFormat` that is not an integer is left
 * for the validator to report.
 */
import type { FormatRefusal, MigrationTable } from '../song/formatUpgrade';
import { formatRefusal, runUpgrades } from '../song/formatUpgrade';
import { PATCH_FILE_FORMAT, upgradePatch } from '../patch/patchMigrations';
import { RACK_FILE_FORMAT } from './rackConstants';

type RawFile = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const integerOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

/** `table[n]` upgrades a rack file at format `n` to `n + 1`. No entry is ever required. */
export const RACK_MIGRATIONS: MigrationTable<RawFile> = {};

/** A rack file refused for its format; the message names the file, the format found and the one read. */
export class RackFormatError extends Error {
  constructor(
    readonly id: string,
    readonly refusal: FormatRefusal,
  ) {
    super(`racks/${id}.json: ${refusal.message}`);
    this.name = 'RackFormatError';
  }
}

export type RackUpgrade = { readonly value: unknown } | { readonly refused: FormatRefusal };

/**
 * A raw `racks/<id>.json` upgraded to this build's formats, with `format`
 * and `patchFormat` written in: the file's own keys through `migrations`,
 * then the embedded patch through `patchMigrations`. Anything that is not a
 * file with integer formats is returned as it came, for the validator.
 */
export function upgradeRackFile(
  raw: unknown,
  migrations: MigrationTable<RawFile> = RACK_MIGRATIONS,
  patchMigrations?: Parameters<typeof upgradePatch>[2],
): RackUpgrade {
  if (!isRecord(raw)) return { value: raw };
  const from = integerOrNull(raw['format']);
  if (from === null) return { value: raw };
  const { value: file, version } = runUpgrades(raw, from, RACK_FILE_FORMAT, migrations);
  if (version !== RACK_FILE_FORMAT)
    return { refused: formatRefusal('rack', from, RACK_FILE_FORMAT) };
  const patchFrom = integerOrNull(file['patchFormat']);
  if (patchFrom === null || !isRecord(file['patch'])) {
    return { value: { ...file, format: RACK_FILE_FORMAT } };
  }
  const patch = upgradePatch(file['patch'], patchFrom, patchMigrations);
  if ('refused' in patch) return patch;
  return {
    value: {
      ...file,
      format: RACK_FILE_FORMAT,
      patchFormat: PATCH_FILE_FORMAT,
      patch: patch.value,
    },
  };
}
