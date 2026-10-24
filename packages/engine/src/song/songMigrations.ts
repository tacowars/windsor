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
import { upgradeDelayEntry } from './delayUpgrade';
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

/** A bloom entry with its Scale renamed; any other entry as it is. */
function renameBloomEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const scale = entry['scale'];
  if (
    entry['kind'] === 'bloom' &&
    typeof scale === 'string' &&
    Object.hasOwn(BLOOM_SCALE_RENAMES, scale)
  )
    return { ...entry, scale: BLOOM_SCALE_RENAMES[scale] };
  return entry;
}

type EntryStep = (entry: Record<string, unknown>) => Record<string, unknown>;

/** One insert entry through `step`, and a host's `slot` child through the same. */
function throughEntry(entry: unknown, step: EntryStep): unknown {
  if (!isRecord(entry)) return entry;
  const out = step(entry);
  return isRecord(entry['slot']) ? { ...out, slot: throughEntry(entry['slot'], step) } : out;
}

/** `holder` with its `inserts` chain through `step`, when it is a record holding a list. */
function throughChain(holder: unknown, step: EntryStep): unknown {
  if (!isRecord(holder) || !Array.isArray(holder['inserts'])) return holder;
  return { ...holder, inserts: holder['inserts'].map((entry) => throughEntry(entry, step)) };
}

/** Each value of a list or a record through `step`; anything else as it is. */
function eachOf(value: unknown, step: (item: unknown) => unknown): unknown {
  if (Array.isArray(value)) return value.map(step);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, step(item)]));
}

/**
 * Every insert in the song through `step`: each part's strip, each group's
 * chain, the master's and each return's, and a host's `slot` child.
 */
function everyInsert(doc: RawDocument, step: EntryStep): RawDocument {
  const out: RawDocument = { ...doc };
  const chain = (holder: unknown): unknown => throughChain(holder, step);
  if (Array.isArray(doc['parts']) || isRecord(doc['parts']))
    out['parts'] = eachOf(doc['parts'], (part) =>
      isRecord(part) && isRecord(part['strip']) ? { ...part, strip: chain(part['strip']) } : part,
    );
  if (doc['groups'] !== undefined) out['groups'] = eachOf(doc['groups'], chain);
  if (doc['returns'] !== undefined) out['returns'] = eachOf(doc['returns'], chain);
  if (doc['master'] !== undefined) out['master'] = chain(doc['master']);
  return out;
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
const bloomScalesRenamed = (doc: RawDocument): RawDocument => everyInsert(doc, renameBloomEntry);

/**
 * Version 15 → 16 (windsor#818, record `2026-10-16-tape-motion-on-a-square-law`):
 * a Tape's `wow` and `flutter`, and `wear`'s wow and flutter while unsplit,
 * drive the motion on a square law (`inserts/tapeMotionCurve.ts`) where the
 * dial's percentage was the motion amount itself. The stored numbers, and the
 * points of a Wow, Flutter or Wear lane, are not rewritten: playing them on
 * the new, gentler curve is the point of the change, and today's 30 % is the
 * new dial's top. `dropouts` keeps its linear scale. A version-15 snapshot
 * already holds the current patch format, and no patch carries a Tape, so
 * `patches` is not touched.
 */
const tapeMotionOnSquareLaw = (doc: RawDocument): RawDocument => doc;

/**
 * Version 17 → 18 (record `2026-10-17-dub-delay-regeneration`): every Dub
 * delay in the song, wherever it sits, in the rebuilt loop's shape
 * (`delayUpgrade.ts`). A version-17 snapshot already holds the current patch
 * format, and no patch carries an insert, so `patches` is not touched.
 */
const delayLoopRebuilt = (doc: RawDocument): RawDocument => everyInsert(doc, upgradeDelayEntry);

/** The sequencer kinds whose Skip step variation replaced (windsor#935). */
const SKIPLESS_KINDS: readonly unknown[] = ['grid', 'arp'];

const isSkipless = (spec: unknown): spec is Record<string, unknown> =>
  isRecord(spec) && SKIPLESS_KINDS.includes(spec['kind']);

/** A Grid or Arp spec without its `skipChance`; any other value as it is. A rack's sequencer upgrades through it too (`rackMigrations.ts`). */
export function withoutSkip(spec: unknown): unknown {
  if (!isSkipless(spec) || !Object.hasOwn(spec, 'skipChance')) return spec;
  const out = { ...spec };
  delete out['skipChance'];
  return out;
}

/** A region with its own Grid or Arp pattern's `skipChance` deleted. */
const regionWithoutSkip = (region: unknown): unknown =>
  isRecord(region) && isSkipless(region['pattern'])
    ? { ...region, pattern: withoutSkip(region['pattern']) }
    : region;

/** A lane on the Skip row, which a Grid or Arp part no longer offers. */
const isSkipLane = (lane: unknown): boolean =>
  isRecord(lane) && lane['target'] === 'seq.skipChance';

/** One part with Skip gone from its Grid or Arp sequencer, its regions' patterns and its lanes. */
function partWithoutSkip(part: unknown): unknown {
  if (!isRecord(part)) return part;
  const out: Record<string, unknown> = { ...part };
  if (isSkipless(part['sequencer'])) {
    out['sequencer'] = withoutSkip(part['sequencer']);
    if (Array.isArray(part['automation'])) {
      out['automation'] = part['automation'].filter((lane) => !isSkipLane(lane));
    }
  }
  if (Array.isArray(part['regions'])) out['regions'] = part['regions'].map(regionWithoutSkip);
  return out;
}

/**
 * Version 18 → 19 (windsor#935, record `2026-10-24-step-variation`): step
 * variation replaced Skip on the Grid and the Arp, so every Grid or Arp
 * sequencer, and every region pattern of either kind, loses its
 * `skipChance`, and a Grid or Arp part loses its `seq.skipChance` lanes. The
 * Figure keeps its Skip. The four new fields are additive, their defaults
 * vary nothing, so the normaliser fills them. A version-18 snapshot already
 * holds the current patch format, so `patches` is not touched.
 */
const skipReplacedByVariation = (doc: RawDocument): RawDocument =>
  Array.isArray(doc['parts']) || isRecord(doc['parts'])
    ? { ...doc, parts: eachOf(doc['parts'], partWithoutSkip) }
    : doc;

/**
 * Eight upgrades ship, 5 → 6, 6 → 7, 7 → 8, 8 → 9, 9 → 10, 15 → 16, 17 → 18 and 18 → 19, and none from
 * 16 to 17 (windsor#842: operator feedback runs to 10 and a feedback step's
 * span is 5, so an old song's step offsets on feedback play five times
 * deeper; tacowars keeps no song to carry, record
 * `2026-10-16-operator-feedback-to-ten`), none from
 * 10 to 11 (windsor#748: the plate's `decay` became seconds, and converting
 * an old gain would take a measured table per Size and diffusion), from 11
 * to 12 (windsor#761: the plate's `build` changes how every plate renders,
 * and no value of it renders a song saved without it as before), from 12
 * to 13 (windsor#764: the plate's `modRate` and `modDepth` drive four
 * irregular sources where they drove one sine and cosine, and no setting
 * renders the old modulation), from 13 to 14 (windsor#746: the plate's
 * `voicing`, whose plate row's shorter input diffusers change how every
 * plate renders, and no voicing renders the old diffusers) or from 14 to 15
 * (windsor#771: the `plate` insert kind renamed `reverb`, with no upgrade by
 * tacowars's decision), so a song saved at any version from 5 to 16 is
 * refused too: the chain stops at 10, and 15 → 16 stops at 16.
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
  15: tapeMotionOnSquareLaw,
  17: delayLoopRebuilt,
  18: skipReplacedByVariation,
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
