/**
 * The one rule both saved formats share (record
 * `2026-09-28-format-versions-refuse-never-destroy`): a song carries an
 * integer `version` and a patch an integer `format`; a table of upgrades,
 * each from one version to the next, runs before the check, and whatever the
 * chain cannot bring to this build's version is refused — reported, never
 * half-read and never deleted.
 */

/** Upgrades a value saved at version `n` to version `n + 1`. */
export type Migration<T> = (value: T) => T;

/** `table[n]` upgrades version `n` to `n + 1`. No entry is ever required. */
export type MigrationTable<T> = Readonly<Record<number, Migration<T>>>;

/** Why a saved song or patch was not loaded: which format, the version it carries and the one this build reads. */
export interface FormatRefusal {
  readonly format: 'song' | 'patch';
  readonly found: number;
  readonly reads: number;
  /** The embedded patch id, when a song is refused for one of its patches. */
  readonly patch?: string;
  /** "saved with song format 99, this build reads 3" — what the console says. */
  readonly message: string;
}

/**
 * The version a saved value declares: `absent` when it declares none, the
 * integer when it is one, and null for anything else — junk the validator
 * reports, not a version to refuse.
 */
export function declaredVersion(raw: unknown, absent: number): number | null {
  if (raw === undefined) return absent;
  return typeof raw === 'number' && Number.isInteger(raw) ? raw : null;
}

/** The value upgraded as far as the table's chain reaches from `from` towards `current`. */
export function runUpgrades<T>(
  value: T,
  from: number,
  current: number,
  table: MigrationTable<T>,
): { value: T; version: number } {
  let out = value;
  let version = from;
  while (version < current && Object.hasOwn(table, version)) {
    out = (table[version] as Migration<T>)(out);
    version += 1;
  }
  return { value: out, version };
}

export function formatRefusal(
  format: FormatRefusal['format'],
  found: number,
  reads: number,
  patch?: string,
): FormatRefusal {
  const where = patch === undefined ? '' : ` in patch "${patch}"`;
  const message = `saved with ${format} format ${found}${where}, this build reads ${reads}`;
  return patch === undefined
    ? { format, found, reads, message }
    : { format, found, reads, patch, message };
}
