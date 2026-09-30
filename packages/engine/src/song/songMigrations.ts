/**
 * Song format upgrades (record `2026-09-28-format-versions-refuse-never-destroy`).
 *
 * A song carries `version` (`ARRANGEMENT_VERSION`). `SONG_MIGRATIONS[n]`
 * upgrades a document at version `n` to `n + 1` and runs before
 * `makeArrangement`'s check; the chain continues while it has an entry
 * (3→4). A version the chain cannot bring to this build's is refused:
 * the document is not loaded, and the console keeps the saved text.
 *
 * A song is self-contained (#562), so its `patches` snapshot is read at the
 * patch format the song's version implies. An embedded patch that declares
 * its own `format` is upgraded through `PATCH_MIGRATIONS`, and one the chain
 * cannot reach refuses the whole song.
 */
import { ARRANGEMENT_VERSION, REVERB_SPACE_RANGES } from '../audioConstants';
import { ECHO_LINE_DEFAULTS } from '../inserts/echoConstants';
import { SEND_BUS_WET_MIX } from '../mixer/mix';
import { SPACES } from '../mixer/reverbSpace';
import { PATCH_MIGRATIONS, upgradePatch } from '../patch/patchMigrations';
import type { FormatRefusal, MigrationTable } from './formatUpgrade';
import { declaredVersion, formatRefusal, runUpgrades } from './formatUpgrade';

type RawDocument = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** `from`'s own `keys`, where it has them: a v3 return's fields, carried as they were. */
function pick(from: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => Object.hasOwn(from, key)).map((k) => [k, from[k]]),
  );
}

/**
 * A v3 return as a v4 bus holding one insert of `kind`, at Mix 1: the
 * return's own `level` kept, `fields` (the effect's settings, already
 * narrowed to the ones v3 read) carried over the v3 base the return
 * overlaid. `kind` and `mix` go last, so no carried field can override
 * them. A return that is not a record is handed on as it is, for the
 * normaliser to report.
 */
function returnAsBus(
  raw: unknown,
  kind: 'plate' | 'echo',
  base: object,
  fields: Record<string, unknown>,
): unknown {
  if (!isRecord(raw)) return raw;
  const insert = { ...base, ...fields, kind, mix: SEND_BUS_WET_MIX };
  return { ...pick(raw, ['level']), inserts: [insert] };
}

/**
 * A strip's `sends` with `room` and `echo` renamed to `a` and `b`. A v3 `a`
 * or `b` named no return in v3 and was dropped on load, so it is dropped
 * here too: it never overrides a renamed value or becomes a valid send.
 * Any other key is left, for the normaliser to report.
 */
function renameSends(sends: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, amount] of Object.entries(sends)) {
    if (V4_SEND_NAMES.has(key)) continue;
    out[V3_SEND_NAMES[key] ?? key] = amount;
  }
  return out;
}

/** What each v3 return became. */
const V3_SEND_NAMES: Readonly<Record<string, string>> = { room: 'a', echo: 'b' };
/** The v4 names, which a v3 send could not carry. */
const V4_SEND_NAMES: ReadonlySet<string> = new Set(Object.values(V3_SEND_NAMES));
/** The fields a v3 `room.space` was read with; the v3 normaliser dropped any other key. */
const V3_SPACE_FIELDS: readonly string[] = Object.keys(REVERB_SPACE_RANGES);
/** The fields a v3 `echo` return's line was read with. */
const V3_ECHO_FIELDS: readonly string[] = Object.keys(ECHO_LINE_DEFAULTS);

/**
 * 3 → 4 (windsor#172; record `2026-09-30-insert-rack-and-send-bus-chains`
 * §7): the fixed `room` and `echo` returns become Send A and Send B, each a
 * level and an insert chain. `room` becomes `a` holding a Plate reverb with
 * its old space, and `echo` becomes `b` holding an Echo with its old line,
 * both at Mix 1, so the song sounds as it did. Only what a v3 load kept is
 * carried: an unknown space or line key, and a v3 send already named `a`
 * or `b`, is dropped as v3 dropped it. An absent `returns` stays
 * absent. Every part's `sends.room` and `sends.echo` become `sends.a` and
 * `sends.b`.
 */
export function sendBusesFromReturns(doc: RawDocument): RawDocument {
  const out: RawDocument = { ...doc };
  if (isRecord(doc.returns)) {
    const { room, echo, ...rest } = doc.returns;
    const returns: Record<string, unknown> = { ...rest };
    if (room !== undefined) {
      const space = isRecord(room) && isRecord(room.space) ? pick(room.space, V3_SPACE_FIELDS) : {};
      returns.a = returnAsBus(room, 'plate', SPACES.hall, space);
    }
    if (echo !== undefined) {
      const line = isRecord(echo) ? pick(echo, V3_ECHO_FIELDS) : {};
      returns.b = returnAsBus(echo, 'echo', ECHO_LINE_DEFAULTS, line);
    }
    out.returns = returns;
  }
  if (Array.isArray(doc.parts)) {
    out.parts = doc.parts.map((part: unknown) => {
      if (!isRecord(part) || !isRecord(part.strip) || !isRecord(part.strip.sends)) return part;
      return { ...part, strip: { ...part.strip, sends: renameSends(part.strip.sends) } };
    });
  }
  return out;
}

/** Version 2 was retired by #705 with no upgrade; 3 upgrades to 4. */
export const SONG_MIGRATIONS: MigrationTable<RawDocument> = { 3: sendBusesFromReturns };

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
