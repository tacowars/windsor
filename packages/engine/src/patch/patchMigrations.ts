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
 * table serves a library file's `patch` and a song's embedded snapshot. The
 * keys a format retires from the file around the patch, which a song never
 * carries, go through `PATCH_FILE_MIGRATIONS` beside it.
 */
import type { FormatRefusal, MigrationTable } from '../song/formatUpgrade';
import { declaredVersion, formatRefusal, runUpgrades } from '../song/formatUpgrade';
import { DRIVE_SOFT, FILT_OFF } from '../worklet/fm/modeIds';
import { OPERATOR_DEFAULTS } from '../worklet/fm/patchDefaults';
import { WAVE } from '../worklet/fm/waveIds';

/**
 * The patch file format this build reads and writes (#561). 2 retired the
 * headroom record and the operators' `userKey` (windsor#60, record
 * `2026-09-28-retire-the-headroom-record`); 3 moved the filter's drive into
 * the voice's own drive stage (windsor#300, record
 * `2026-10-01-voice-drive-stage`); 4 renamed a Noise operator's `noiseLp`
 * and `noiseHp` to `opLp` and `opHp`, heard on every wave (windsor#590,
 * record `2026-10-04-operator-filters-on-every-wave`).
 */
export const PATCH_FILE_FORMAT = 4;

/** The format of a file that declares none: every file written before the check. */
export const PATCH_FORMAT_ABSENT = 1;

type RawPatch = Record<string, unknown>;
type RawFile = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** `record` without `key`, key order otherwise kept. */
function withoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const out = { ...record };
  delete out[key];
  return out;
}

/**
 * Format 1 → 2: the dead `userKey` leaves every operator (the wave cache is
 * keyed by the partials since #511). A partial patch, as a song embeds, is
 * upgraded as far as it goes: no `ops`, or an operator that is not an object,
 * is left for the normaliser.
 */
function retireUserKey(patch: RawPatch): RawPatch {
  if (!Array.isArray(patch['ops'])) return patch;
  const ops: unknown[] = patch['ops'];
  return { ...patch, ops: ops.map((op) => (isRecord(op) ? withoutKey(op, 'userKey') : op)) };
}

/** The filter's mode as the worklet reads it (`num(mode, FILT_OFF) | 0`): on unless it is Off. */
function filterIsOn(filter: Record<string, unknown>): boolean {
  const mode = filter['mode'];
  return typeof mode === 'number' && Number.isFinite(mode) && (mode | 0) !== FILT_OFF;
}

/**
 * Format 2 → 3: `filter.drive` leaves the filter for the voice's drive stage
 * (windsor#300), which no longer needs the filter. With the filter on, the
 * stage takes its gain, soft shape, no bias and an open tone: the same
 * arithmetic as before, bit for bit. With the filter Off the old drive was
 * never heard, so the stage stays at unity gain, bypassed. A patch with no
 * `filter.drive` (a partial one, at the default) is left as it is.
 */
function moveDriveOutOfFilter(patch: RawPatch): RawPatch {
  const filter = patch['filter'];
  if (!isRecord(filter) || !Object.hasOwn(filter, 'drive')) return patch;
  const gain = filterIsOn(filter) ? filter['drive'] : 1;
  return {
    ...patch,
    filter: withoutKey(filter, 'drive'),
    drive: { gain, shape: DRIVE_SOFT, bias: 0, tone: 1 },
  };
}

/** `record` with `from` renamed `to`, its value and place kept; one without `from` is returned as it is. */
function renameKey(
  record: Record<string, unknown>,
  from: string,
  to: string,
): Record<string, unknown> {
  if (!Object.hasOwn(record, from)) return record;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) out[key === from ? to : key] = value;
  return out;
}

/** The operator's wave as the normaliser reads it (`num(o.wave, OPERATOR_DEFAULTS.wave) | 0`). */
function operatorWave(op: Record<string, unknown>): number {
  const wave = op['wave'];
  return typeof wave === 'number' && Number.isFinite(wave) ? wave | 0 : OPERATOR_DEFAULTS.wave;
}

/**
 * Format 3 → 4 (windsor#590): every operator's `noiseLp` and `noiseHp`
 * become `opLp` and `opHp`, in place. Format 3 heard them on a Noise
 * operator only, and the old editor kept a filtered Noise operator's values
 * when its wave changed, so a Noise operator keeps its values and any other
 * wave's are written 0: the patch sounds as it did. `opTrack` is left to the
 * normaliser's 0. A partial patch is upgraded as far as it goes, as
 * `retireUserKey`'s is: a key it lacks stays absent, at the normaliser's 0.
 */
function renameOperatorFilters(patch: RawPatch): RawPatch {
  if (!Array.isArray(patch['ops'])) return patch;
  const ops: unknown[] = patch['ops'];
  const renamed = (op: Record<string, unknown>): Record<string, unknown> => {
    const out = renameKey(renameKey(op, 'noiseLp', 'opLp'), 'noiseHp', 'opHp');
    if (operatorWave(op) === WAVE.NOISE) return out;
    if (Object.hasOwn(op, 'noiseLp')) out['opLp'] = 0;
    if (Object.hasOwn(op, 'noiseHp')) out['opHp'] = 0;
    return out;
  };
  return { ...patch, ops: ops.map((op) => (isRecord(op) ? renamed(op) : op)) };
}

export const PATCH_MIGRATIONS: MigrationTable<RawPatch> = {
  1: retireUserKey,
  2: moveDriveOutOfFilter,
  3: renameOperatorFilters,
};

/**
 * The file around the patch, format `n` → `n + 1`, for the steps that retire
 * one of its own keys; a step with no entry leaves the file as it is. 1 → 2
 * drops the `headroom` record: a test result that nothing at runtime read.
 */
export const PATCH_FILE_MIGRATIONS: MigrationTable<RawFile> = {
  1: (file) => withoutKey(file, 'headroom'),
};

/** Every step of `table` from `from` to this build's format, skipping a step with no entry. */
function upgradeFileKeys(file: RawFile, from: number, table: MigrationTable<RawFile>): RawFile {
  let out = file;
  for (let version = from; version < PATCH_FILE_FORMAT; version++) {
    const step = Object.hasOwn(table, version) ? table[version] : undefined;
    if (step) out = step(out);
  }
  return out;
}

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
 * written in: the patch through `migrations`, which decides whether the file
 * is read at all, and the file's own keys through `fileMigrations`, step by
 * step where a step has one. Anything that is not a file with an integer
 * format is returned as it came, for the validator to report.
 */
export function upgradePatchFile(
  raw: unknown,
  migrations: MigrationTable<RawPatch> = PATCH_MIGRATIONS,
  fileMigrations: MigrationTable<RawFile> = PATCH_FILE_MIGRATIONS,
): PatchUpgrade<unknown> {
  const from = isRecord(raw) ? declaredVersion(raw['format'], PATCH_FORMAT_ABSENT) : null;
  if (!isRecord(raw) || from === null) return { value: raw };
  const patch = isRecord(raw['patch']) ? raw['patch'] : {};
  const upgraded = upgradePatch(patch, raw['format'], migrations);
  if ('refused' in upgraded) return upgraded;
  const file: RawFile = {
    ...upgradeFileKeys(raw, from, fileMigrations),
    format: PATCH_FILE_FORMAT,
  };
  if (isRecord(raw['patch'])) file['patch'] = upgraded.value;
  return { value: file };
}
