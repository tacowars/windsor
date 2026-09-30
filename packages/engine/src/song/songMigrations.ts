/**
 * Song format upgrades (record `2026-09-28-format-versions-refuse-never-destroy`).
 *
 * A song carries `version` (`ARRANGEMENT_VERSION`). `SONG_MIGRATIONS[n]`
 * upgrades a document at version `n` to `n + 1` and runs before
 * `makeArrangement`'s check; the chain continues while it has an entry. A
 * version the chain cannot bring to this build's is refused: the document is
 * not loaded, and the console keeps the saved text.
 *
 * A song is self-contained (#562), so its `patches` snapshot is read at the
 * patch format the song's version implies. An embedded patch that declares
 * its own `format` is upgraded through `PATCH_MIGRATIONS`, and one the chain
 * cannot reach refuses the whole song.
 */
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { PATCH_MIGRATIONS, upgradePatch } from '../patch/patchMigrations';
import type { FormatRefusal, MigrationTable } from './formatUpgrade';
import { declaredVersion, formatRefusal, runUpgrades } from './formatUpgrade';

type RawDocument = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * No upgrades ship. Version 2 was retired by #705 and version 3 by windsor#238
 * (record `2026-10-01-retire-song-version-3`), each with no upgrade, so a
 * song saved at either is refused.
 */
export const SONG_MIGRATIONS: MigrationTable<RawDocument> = {};

/** The tables `upgradeSong` runs; a test hands its own. */
export interface FormatMigrations {
  readonly songs: MigrationTable<RawDocument>;
  readonly patches: MigrationTable<RawDocument>;
}

const SHIPPED: FormatMigrations = { songs: SONG_MIGRATIONS, patches: PATCH_MIGRATIONS };

/** The document to normalise, and the refusal when there is nothing this build may read. */
export interface SongUpgrade {
  readonly document: unknown;
  readonly refused?: FormatRefusal;
}

/**
 * A raw song upgraded to this build's version, or refused. A document with
 * no integer version is not a version question: it comes back as it came,
 * for the normaliser to report. A refused document also comes back as it
 * came, never partly upgraded.
 */
export function upgradeSong(raw: unknown, migrations: FormatMigrations = SHIPPED): SongUpgrade {
  if (!isRecord(raw)) return { document: raw };
  // No version at all is the retired four-slot shape or junk, not a version to refuse.
  const from =
    raw['version'] === undefined ? null : declaredVersion(raw['version'], ARRANGEMENT_VERSION);
  if (from === null) return { document: raw };
  const { value, version } = runUpgrades(raw, from, ARRANGEMENT_VERSION, migrations.songs);
  if (version !== ARRANGEMENT_VERSION) {
    return { document: raw, refused: formatRefusal('song', from, ARRANGEMENT_VERSION) };
  }
  const document: RawDocument = { ...value, version };
  const patches = upgradeSnapshot(document['patches'], migrations.patches);
  if ('refused' in patches) return { document: raw, refused: patches.refused };
  if (isRecord(document['patches'])) document['patches'] = patches.value;
  return { document };
}

/** The embedded patches that declare a `format`, upgraded with the key removed; the first refusal refuses all. */
function upgradeSnapshot(
  raw: unknown,
  migrations: MigrationTable<RawDocument>,
): { value: unknown } | { refused: FormatRefusal } {
  if (!isRecord(raw)) return { value: raw };
  const out: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!isRecord(entry) || !Object.hasOwn(entry, 'format')) {
      out[id] = entry;
      continue;
    }
    const { format, ...patch } = entry;
    const upgraded = upgradePatch(patch, format, migrations);
    if ('refused' in upgraded) {
      const { found, reads } = upgraded.refused;
      return { refused: formatRefusal('patch', found, reads, id) };
    }
    // A format that is not an integer stays, for the normaliser to report as junk.
    out[id] = declaredVersion(format, 0) === null ? entry : upgraded.value;
  }
  return { value: out };
}
