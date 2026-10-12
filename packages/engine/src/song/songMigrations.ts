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
 * The snapshot's patches through the patch table's step from format `from`,
 * so the song plays as it did. A patch that declares its own `format` is
 * left for `upgradeSnapshot`, which reads that format instead.
 */
function snapshotPatchStep(doc: RawDocument, from: number): RawDocument {
  const patches = doc['patches'];
  const step = PATCH_MIGRATIONS[from];
  if (!isRecord(patches) || !step) return doc;
  const out: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(patches)) {
    out[id] = isRecord(entry) && !Object.hasOwn(entry, 'format') ? step(entry) : entry;
  }
  return { ...doc, patches: out };
}

/** The patch format each song version's snapshot holds, for the versions an upgrade leaves. */
const SNAPSHOT_PATCH_FORMAT = { versionFive: 2, versionSix: 3 };

/** Version 5 → 6 (windsor#300, record `2026-10-01-voice-drive-stage`): patch format 2 to 3. */
const snapshotToPatchFormatThree = (doc: RawDocument): RawDocument =>
  snapshotPatchStep(doc, SNAPSHOT_PATCH_FORMAT.versionFive);

/**
 * Version 6 → 7 (windsor#590, record
 * `2026-10-04-operator-filters-on-every-wave`): patch format 3 to 4, the
 * operators' `noiseLp` and `noiseHp` renamed `opLp` and `opHp`.
 */
const snapshotToPatchFormatFour = (doc: RawDocument): RawDocument =>
  snapshotPatchStep(doc, SNAPSHOT_PATCH_FORMAT.versionSix);

/**
 * Version 7 → 8 (windsor#626): a Filter insert's Reso row moved from a
 * linear to a log scale, so a saved Reso lane plays along the log curve
 * between its points. No lane is rewritten: the Filter insert shipped the
 * same day (windsor#622), and a Reso lane saved at version 7 plays along the
 * log curve from version 8. A version-7 snapshot already holds the current
 * patch format, so `patches` is not touched.
 */
const filterResoOnLogScale = (doc: RawDocument): RawDocument => doc;

/**
 * Version 8 → 9 (RV-4): a Retro Reverb's Size row moved from a linear to a
 * log scale, so a saved Size lane plays along the log curve between its
 * points. No lane is rewritten: a Size lane saved at version 8 plays along
 * the log curve from version 9. A version-8 snapshot already holds the
 * current patch format, so `patches` is not touched.
 */
const retroSizeOnLogScale = (doc: RawDocument): RawDocument => doc;

/** bloom's Scale values renamed to Windsor's `SCALE_NAMES` at version 10 (windsor#728). */
const BLOOM_SCALE_RENAMES: Readonly<Record<string, string>> = {
  minor: 'naturalMinor',
  'pentatonic-major': 'pentatonicMajor',
  'pentatonic-minor': 'pentatonicMinor',
};

/** One insert entry with a bloom's Scale renamed, and a host's `slot` child through the same. */
function renameBloomEntry(entry: unknown): unknown {
  if (!isRecord(entry)) return entry;
  let out = entry;
  const scale = entry['scale'];
  if (
    entry['kind'] === 'bloom' &&
    typeof scale === 'string' &&
    Object.hasOwn(BLOOM_SCALE_RENAMES, scale)
  )
    out = { ...out, scale: BLOOM_SCALE_RENAMES[scale] };
  if (isRecord(entry['slot'])) out = { ...out, slot: renameBloomEntry(entry['slot']) };
  return out;
}

/** `holder` with its `inserts` chain renamed, when it is a record holding a list. */
function renameBloomChain(holder: unknown): unknown {
  if (!isRecord(holder) || !Array.isArray(holder['inserts'])) return holder;
  return { ...holder, inserts: holder['inserts'].map(renameBloomEntry) };
}

/** Each value of a list or a record through `step`; anything else as it is. */
function eachOf(value: unknown, step: (item: unknown) => unknown): unknown {
  if (Array.isArray(value)) return value.map(step);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, step(item)]));
}

/**
 * Version 9 → 10 (windsor#728, record `2026-10-11-bloom-follows-the-song`):
 * bloom's Scale list became Windsor's `SCALE_NAMES`, so its `minor`,
 * `pentatonic-major` and `pentatonic-minor` are renamed `naturalMinor`,
 * `pentatonicMajor` and `pentatonicMinor` on every bloom in the song: each
 * part's strip, each group's chain, the master's and each return's, and a
 * host's `slot` child. The pitch classes are the same, so the song sounds as
 * it did. A version-9 snapshot already holds the current patch format.
 */
function bloomScalesRenamed(doc: RawDocument): RawDocument {
  const out: RawDocument = { ...doc };
  if (Array.isArray(doc['parts']) || isRecord(doc['parts']))
    out['parts'] = eachOf(doc['parts'], (part) =>
      isRecord(part) && isRecord(part['strip'])
        ? { ...part, strip: renameBloomChain(part['strip']) }
        : part,
    );
  if (doc['groups'] !== undefined) out['groups'] = eachOf(doc['groups'], renameBloomChain);
  if (doc['returns'] !== undefined) out['returns'] = eachOf(doc['returns'], renameBloomChain);
  if (doc['master'] !== undefined) out['master'] = renameBloomChain(doc['master']);
  return out;
}

/**
 * Five upgrades ship, 5 → 6, 6 → 7, 7 → 8, 8 → 9 and 9 → 10, and none from
 * 10 to 11 (windsor#748: the plate's `decay` became seconds, and converting
 * an old gain would take a measured table per Size and diffusion), from 11
 * to 12 (windsor#761: the plate's `build` changes how every plate renders,
 * and no value of it renders a song saved without it as before), from 12
 * to 13 (windsor#764: the plate's `modRate` and `modDepth` drive four
 * irregular sources where they drove one sine and cosine, and no setting
 * renders the old modulation) or from 13 to 14 (windsor#746: the plate's
 * `voicing`, whose plate row's shorter input diffusers change how every
 * plate renders, and no voicing renders the old diffusers), so a song saved
 * at any version from 5 to 13 is refused too: the chain stops at 10.
 * Version 2 was retired by #705, version 3 by windsor#238 (record
 * `2026-10-01-retire-song-version-3`) and version 4 by windsor#224, each
 * with no upgrade, so a song saved at any of them is refused.
 */
export const SONG_MIGRATIONS: MigrationTable<RawDocument> = {
  5: snapshotToPatchFormatThree,
  6: snapshotToPatchFormatFour,
  7: filterResoOnLogScale,
  8: retroSizeOnLogScale,
  9: bloomScalesRenamed,
};

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
