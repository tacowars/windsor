/**
 * The arrangement document layer (issue #75; record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §3–§5).
 *
 * An arrangement is a JSON document — a song the console opens, imports or
 * builds (in Aotearoa204, a file committed under `arrangements/` and imported
 * at build time) — handed to `makeArrangement`, the never-throws normaliser
 * between the document and the engine. It clamps
 * every number into range, defaults absent fields, drops unknown keys, and
 * reports everything it corrected, distinguishing a document it repaired from
 * one with nothing usable in it, which yields the metronome
 * `FALLBACK_ARRANGEMENT` (record §4).
 *
 * Dangling names — a preset, return, part or strip the document mentions and
 * the code does not define — are reported separately in `dangling`: clamping
 * cannot fix a dangling name, it is an error wearing a valid type. A dangling
 * name never blocks playback here (the part is dropped, or the send is), but
 * it fails `npm run verify` through `arrangementGate.test.ts`, which is what
 * guarantees the fallback — and a document full of holes — is never what
 * ships (record §5).
 */
import { ARRANGEMENT_VERSION, MUSIC_PARTS_MAX } from '../audioConstants';
import type {
  Arrangement,
  Harmony,
  MusicPart,
  PartsPartial,
  DeepPartial,
  Transport,
} from './arrangement';
import { songTicks } from '../sequencing/meter';
import { normaliseSongSidechains } from './sidechainNormalise';
import { show } from './arrangementFields';
import { ArrangementNormaliser } from './arrangementNormalise';
import { normaliseMaster } from '../mixer/masterSpec';
import type { MasterSpec } from '../mixer/masterSpec';
import { normaliseReturns } from './deskNormalise';
import { normaliseGroupOutputs, normaliseGroups } from './groupNormalise';
import { FALLBACK_ARRANGEMENT } from './fallbackArrangement';
import { normaliseSongMeta } from './songMetaNormalise';
import type { ChannelStrip, GroupSpec, ReturnSpec } from '../mixer/mix';
import type { AutomationLane } from '../automation/automationLane';
import type { Patch } from '../patch/patch';
import type { ResolveOptions } from './arrangementValidate';
import type { FormatRefusal } from './formatUpgrade';
import { upgradeSong } from './songMigrations';
import { buildsNoGenerator } from './partGenerators';
import { colourParts, type UncolouredPart } from './partColours';

export { FALLBACK_ARRANGEMENT };

/** A part as the document holds it: the player's part plus its own strip (#597) and lanes. */
export interface DocumentPart extends MusicPart {
  /**
   * The part's colour (windsor#641, record `2026-10-07-part-colours`): an
   * index into the app's part palette, 0 to `PART_COLOURS - 1`. Nothing that
   * plays reads it. The normaliser fills it when absent or invalid
   * (`partColours.ts`), so a normalised part always has one.
   */
  readonly colour: number;
  /** Level, pan and sends — owned by the part, not looked up by name. */
  readonly strip: ChannelStrip;
  /**
   * The part's automation lanes (windsor#342, record
   * `2026-10-01-song-automation-lanes`): curves over song time on its strip,
   * its inserts (by insert id) and its voice. Absent when it has none; a
   * partial replaces the whole list. `automation/automationPlayer.ts` plays them (windsor#344).
   */
  readonly automation?: readonly AutomationLane[];
  /**
   * The library id this part's own copy of its patch came from (windsor#669,
   * record `2026-10-10-each-part-owns-its-patch`): set only when `preset`
   * differs from that id, so the app's Save, Revert and modified marker can
   * still find the library entry. Absent when the part's `preset` is its own
   * library link or it has none. Nothing that plays reads it.
   */
  readonly patchSource?: string;
}

/**
 * What a committed `arrangements/<name>.json` holds: the arrangement, its
 * parts each with their strip, plus the two sections that make it the whole
 * piece of music in one file (record
 * `2026-09-11-music-document-carries-patches-and-returns`) — the synth
 * patches its parts play, and the send buses over the code's `RETURNS`,
 * applied at `initMusic` and live through `AudioSystem.apply`.
 */
export type ArrangementDocument = Omit<Arrangement, 'parts'> & {
  /** The document format (windsor#172: 4; a 3 is upgraded). Anything else — v2 and the retired four-slot shape included — is unusable. */
  readonly version: typeof ARRANGEMENT_VERSION;
  readonly parts: readonly DocumentPart[];
  /**
   * Named FM patches — the only place a part's `preset` resolves (#562).
   * A song carries a snapshot of every patch it plays, so improving
   * `patches/<id>.json` never changes what a shipped song sounds like.
   */
  readonly patches?: Readonly<Record<string, Patch>>;
  /** The send buses by name, `a` and `b` (windsor#172): each one's level and insert chain. An absent bus is the code's. */
  readonly returns?: Readonly<Record<string, ReturnSpec>>;
  /**
   * The group buses (windsor#284), in display order, at most `MAX_GROUPS`.
   * A part's Output names one by id. Absent when the song has none.
   */
  readonly groups?: readonly GroupSpec[];
  readonly master?: MasterSpec;
  /**
   * The song's own name and tags (windsor#440), so an exported file is the
   * whole song. Absent when the name is empty and there are no tags. The
   * browser's storage id and times are never here: they belong to its copy.
   */
  readonly meta?: SongMeta;
};

/** A song's name and tags, normalised by `songMetaNormalise.ts`. */
export interface SongMeta {
  readonly name: string;
  readonly tags: readonly string[];
}

/**
 * A live partial of a document: parts by slot, groups by id, patches and
 * returns by name. `null` at a slot, a group id or a patch id removes that
 * entry, a whole part at a free slot adds one (#629), and a whole group at
 * a free id adds one (windsor#284) — the same partial the engine's `apply`
 * takes. A `meta` replaces the song's name and tags whole, and changes no audio.
 */
export type DocumentPartial = DeepPartial<
  Omit<ArrangementDocument, 'parts' | 'patches' | 'groups' | 'meta'>
> & {
  readonly meta?: SongMeta;
  readonly parts?: PartsPartial<DocumentPart>;
  readonly patches?: Readonly<Record<string, DeepPartial<Patch> | null>>;
  readonly groups?: PartsPartial<GroupSpec>;
};

export interface MakeArrangementResult {
  document: ArrangementDocument;
  /** Field-level repairs: clamps, junk replaced by defaults, dropped keys and parts. */
  corrections: string[];
  /** Names the document mentions and the code does not define (record §5). */
  dangling: string[];
  /**
   * Patch ids a `libraryFill` supplied because the document did not embed
   * them (#562) — now embedded in `document.patches`, so the next export
   * carries them. Always empty on the playback path, which hands no fill.
   */
  filled: string[];
  /** False when nothing usable survived; `document` is then `FALLBACK_ARRANGEMENT`. */
  usable: boolean;
  /**
   * Set when the song, or a patch in its snapshot, is a format this build
   * cannot read and no upgrade reaches (record
   * `2026-09-28-format-versions-refuse-never-destroy`): `usable` is false, and
   * a caller holding the saved text keeps it rather than the fallback.
   */
  refused?: FormatRefusal;
}

/**
 * Normalise a raw document (record §5). Never throws, and every value in the
 * result satisfies the generator constructors' asserted ranges, so building
 * an `ArrangementPlayer` from it cannot throw either.
 *
 * With no options this is the playback rule (#562): a part's `preset` resolves
 * against the document's own `patches` and nothing else. The editor passes
 * `{ libraryFill: PRESETS }` so a document written before #562 still opens —
 * every name it resolves that way is embedded into the returned document and
 * listed in `filled`.
 */
export function makeArrangement(raw: unknown, options: ResolveOptions = {}): MakeArrangementResult {
  const n = new ArrangementNormaliser(options);
  // The upgrades run before the version check; a song refused for its own
  // version meets the check's correction below, one refused for a patch
  // in its snapshot is refused whole (a song is self-contained, #562).
  const { document: upgraded, refused } = upgradeSong(raw);
  if (refused?.patch !== undefined) n.correction(`patches.${refused.patch}: ${refused.message}`);
  const document = refused?.patch === undefined ? normalise(upgraded, n) : null;
  if (!document) {
    n.correction('nothing usable survives normalisation — falling back to the metronome');
    return {
      document: FALLBACK_ARRANGEMENT,
      corrections: n.corrections,
      dangling: n.dangling,
      filled: [...n.filled],
      usable: false,
      ...(refused && { refused }),
    };
  }
  return {
    document,
    corrections: n.corrections,
    dangling: n.dangling,
    filled: [...n.filled],
    usable: true,
  };
}

/**
 * The verify gate's predicate: usable, naming nothing the code does not
 * define, and with something to play. A part plays only when its kind builds
 * a generator (`buildsNoGenerator`): a `none` part is inert and allowed (#597),
 * but a song of nothing but such parts is silent and must not ship.
 */
export function isShippable(result: MakeArrangementResult): boolean {
  return (
    result.usable &&
    result.dangling.length === 0 &&
    result.document.parts.some((part) => !buildsNoGenerator(part.sequencer.kind))
  );
}

const DOCUMENT_KEYS = [
  'version',
  'transport',
  'harmony',
  'patches',
  'parts',
  'returns',
  'groups',
  'master',
  'meta',
];

/** The top-level keys of the retired four-slot format, named in its correction. */
const RETIRED_SLOT_KEYS = ['kick', 'hat', 'arp', 'drone', 'mix'];
/** The version whose songs #705 retired without a migration (epic #703 decisions 3 and 4). */
const RETIRED_VERSION = 2;

/** Assembled field by field because the desk sections are optional. */
interface MutableDocument {
  version: typeof ARRANGEMENT_VERSION;
  transport: Transport;
  harmony: Harmony;
  parts: DocumentPart[];
  patches?: Record<string, Patch>;
  returns?: Record<string, ReturnSpec>;
  groups?: GroupSpec[];
  master?: MasterSpec;
  meta?: SongMeta;
}

function normalise(raw: unknown, n: ArrangementNormaliser): ArrangementDocument | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    n.correction(`document: ${show(raw)} is not an object`);
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== ARRANGEMENT_VERSION) {
    n.correction(`version: ${show(o.version)} is not ${ARRANGEMENT_VERSION}${versionReason(o)}`);
    return null;
  }
  n.dropUnknown(o, DOCUMENT_KEYS, '');
  // The patches come first: the parts' preset names resolve against them;
  // the transport next, because the regions and events clamp to its length.
  const embedded = n.patches(o.patches);
  const transport = n.transport(o.transport);
  const parts = normaliseParts(o.parts, n, transport);
  // No part left: an absent part must not be invented (record §4), so this
  // document has nothing to play and the caller falls back.
  if (parts.length === 0) return null;

  const document: MutableDocument = {
    version: ARRANGEMENT_VERSION,
    transport,
    harmony: n.harmony(o.harmony, songTicks(transport.bars, transport.meter)),
    parts,
  };
  // A library fill is embedded here and nowhere else (#562): from this point
  // the document is self-contained, so the export and the playback path are the
  // same document.
  const patches = { ...embedded, ...n.filledPatches() };
  if (Object.keys(patches).length > 0) document.patches = patches;
  const returns = normaliseReturns(o.returns, n);
  if (returns) document.returns = returns;
  // A group's lanes are fitted to the song's length, as a part's are (windsor#614).
  const groups = normaliseGroups(o.groups, n, songTicks(transport.bars, transport.meter));
  if (groups) document.groups = groups;
  if (o.master !== undefined) document.master = normaliseMaster(o.master, n);
  const meta = normaliseSongMeta(o.meta, n);
  if (meta) document.meta = meta;
  return normaliseSongSidechains(normaliseGroupOutputs(document, n), n);
}

/** Why another version is refused, when the shape says which retired format it is. */
function versionReason(o: Record<string, unknown>): string {
  if (o.version === RETIRED_VERSION) return ' — version 2 is not supported since #705';
  if (RETIRED_SLOT_KEYS.some((key) => Object.hasOwn(o, key))) {
    return ' — this is the retired four-slot format (#597), which is no longer read';
  }
  return '';
}

/**
 * The part list: at most eight, each on a unique slot. Two parts on one slot
 * would fight over one engine part and one generator stream — the later
 * creation replaces the earlier, leaving the first uncontrollable and
 * undisposed — so the later part drops, reported. A Figure's canon source is
 * checked against the list that survives (windsor#484).
 */
function normaliseParts(
  raw: unknown,
  n: ArrangementNormaliser,
  transport: Transport,
): DocumentPart[] {
  if (!Array.isArray(raw)) {
    n.correction(`parts: ${show(raw)} is not a list of parts`);
    return [];
  }
  if (raw.length > MUSIC_PARTS_MAX) {
    n.correction(`parts: ${raw.length} parts — only the first ${MUSIC_PARTS_MAX} are kept`);
  }
  const out: UncolouredPart<Omit<DocumentPart, 'colour'>>[] = [];
  const used = new Set<number>();
  raw.slice(0, MUSIC_PARTS_MAX).forEach((entry, i) => {
    const read = n.part(entry, `parts[${i}]`, transport);
    if (!read) return;
    if (used.has(read.part.slot)) {
      n.correction(`parts[${i}]: slot ${read.part.slot} is already used — part dropped`);
      return;
    }
    used.add(read.part.slot);
    out.push(read);
  });
  // Colours are assigned over the list that survives (windsor#641), so a
  // dropped part's colour is free for the others.
  return n.figureSources(colourParts(out, n));
}
