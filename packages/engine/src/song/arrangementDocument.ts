/**
 * The arrangement document layer (issue #75; record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §3–§5).
 *
 * An arrangement is a JSON document committed under `arrangements/`, imported
 * at build time — never fetched, so a malformed file fails `npm run build`
 * and cannot reach a running game — and handed to `makeArrangement`, the
 * never-throws normaliser between the document and the engine. It clamps
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
import {
  ARRANGEMENT_VERSION,
  BPM_MAX,
  BPM_MIN,
  DEFAULT_BPM,
  MUSIC_PARTS_MAX,
} from '../audioConstants';
import type {
  Arrangement,
  ArrangementKey,
  MusicPart,
  PartsPartial,
  DeepPartial,
} from './arrangement';
import { show } from './arrangementFields';
import { ArrangementNormaliser } from './arrangementNormalise';
import { normaliseReturns } from './deskNormalise';
import { FALLBACK_ARRANGEMENT } from './fallbackArrangement';
import type { ChannelStrip, ReturnSpec } from '../mixer/mix';
import type { Patch } from '../patch/patch';
import type { ResolveOptions } from './arrangementValidate';

export { FALLBACK_ARRANGEMENT };

/** A part as the document holds it: the player's part plus its own strip (#597). */
export interface DocumentPart extends MusicPart {
  /** Level, pan and sends — owned by the part, not looked up by name. */
  readonly strip: ChannelStrip;
}

/**
 * What a committed `arrangements/<name>.json` holds: the arrangement, its
 * parts each with their strip, plus the two sections that make it the whole
 * piece of music in one file (record
 * `2026-09-11-music-document-carries-patches-and-returns`) — the synth
 * patches its parts play, and return overlays over the code's `RETURNS`,
 * applied at `initMusic` and live through `AudioSystem.apply`.
 */
export type ArrangementDocument = Omit<Arrangement, 'parts'> & {
  /** The document format (#597). Anything else — the retired four-slot shape included — is unusable. */
  readonly version: typeof ARRANGEMENT_VERSION;
  readonly parts: readonly DocumentPart[];
  /**
   * Named FM patches — the only place a part's `preset` resolves (#562).
   * A song carries a snapshot of every patch it plays, so improving
   * `patches/<id>.json` never changes what a shipped song sounds like.
   */
  readonly patches?: Readonly<Record<string, Patch>>;
  /** Return settings by return name — the plate's space and level, the delay's time, feedback, damp and level. */
  readonly returns?: Readonly<Record<string, ReturnSpec>>;
};

/**
 * A live partial of a document: parts by slot, patches and returns by name.
 * `null` at a slot or a patch id removes that entry, and a whole part at a
 * free slot adds one (#629) — the same partial the engine's `apply` takes.
 */
export type DocumentPartial = DeepPartial<Omit<ArrangementDocument, 'parts' | 'patches'>> & {
  readonly parts?: PartsPartial<DocumentPart>;
  readonly patches?: Readonly<Record<string, DeepPartial<Patch> | null>>;
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
   * carries them. Always empty on the game path, which hands no fill.
   */
  filled: string[];
  /** False when nothing usable survived; `document` is then `FALLBACK_ARRANGEMENT`. */
  usable: boolean;
}

/**
 * Normalise a raw document (record §5). Never throws, and every value in the
 * result satisfies the generator constructors' asserted ranges, so building
 * an `ArrangementPlayer` from it cannot throw either.
 *
 * With no options this is the game rule (#562): a part's `preset` resolves
 * against the document's own `patches` and nothing else. The editor passes
 * `{ libraryFill: PRESETS }` so a document written before #562 still opens —
 * every name it resolves that way is embedded into the returned document and
 * listed in `filled`.
 */
export function makeArrangement(raw: unknown, options: ResolveOptions = {}): MakeArrangementResult {
  const n = new ArrangementNormaliser(options);
  const document = normalise(raw, n);
  if (!document) {
    n.correction('nothing usable survives normalisation — falling back to the metronome');
    return {
      document: FALLBACK_ARRANGEMENT,
      corrections: n.corrections,
      dangling: n.dangling,
      filled: [...n.filled],
      usable: false,
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
 * define, and with something to play. A `none` part is inert and allowed
 * (#597), but a song of nothing but `none` parts is silent and must not ship.
 */
export function isShippable(result: MakeArrangementResult): boolean {
  return (
    result.usable &&
    result.dangling.length === 0 &&
    result.document.parts.some((part) => part.sequencer.kind !== 'none')
  );
}

const DOCUMENT_KEYS = ['version', 'seed', 'bpm', 'key', 'patches', 'parts', 'returns'];

/** The top-level keys of the retired four-slot format, named in its correction. */
const RETIRED_SLOT_KEYS = ['kick', 'hat', 'arp', 'drone', 'mix'];

/** Assembled field by field because the desk sections are optional. */
interface MutableDocument {
  version: typeof ARRANGEMENT_VERSION;
  seed: number;
  bpm: number;
  key: ArrangementKey;
  parts: DocumentPart[];
  patches?: Record<string, Patch>;
  returns?: Record<string, ReturnSpec>;
}

function normalise(raw: unknown, n: ArrangementNormaliser): ArrangementDocument | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    n.correction(`document: ${show(raw)} is not an object`);
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== ARRANGEMENT_VERSION) {
    const retired = RETIRED_SLOT_KEYS.some((key) => Object.hasOwn(o, key));
    n.correction(
      `version: ${show(o.version)} is not ${ARRANGEMENT_VERSION}` +
        (retired ? ' — this is the retired four-slot format (#597), which is no longer read' : ''),
    );
    return null;
  }
  n.dropUnknown(o, DOCUMENT_KEYS, '');
  // The patches come first: the parts' preset names resolve against them.
  const embedded = n.patches(o.patches);
  const parts = normaliseParts(o.parts, n);
  // No part left: an absent part must not be invented (record §4), so this
  // document has nothing to play and the caller falls back.
  if (parts.length === 0) return null;

  const document: MutableDocument = {
    version: ARRANGEMENT_VERSION,
    seed: n.int(o.seed, 0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'seed'),
    bpm: n.num(o.bpm, DEFAULT_BPM, BPM_MIN, BPM_MAX, 'bpm'),
    key: n.key(o.key),
    parts,
  };
  // A library fill is embedded here and nowhere else (#562): from this point
  // the document is self-contained, so the export and the game path are the
  // same document.
  const patches = { ...embedded, ...n.filledPatches() };
  if (Object.keys(patches).length > 0) document.patches = patches;
  const returns = normaliseReturns(o.returns, n);
  if (returns) document.returns = returns;
  return document;
}

/**
 * The part list: at most eight, each on a unique slot. Two parts on one slot
 * would fight over one engine part and one generator stream — the later
 * creation replaces the earlier, leaving the first uncontrollable and
 * undisposed — so the later part drops, reported.
 */
function normaliseParts(raw: unknown, n: ArrangementNormaliser): DocumentPart[] {
  if (!Array.isArray(raw)) {
    n.correction(`parts: ${show(raw)} is not a list of parts`);
    return [];
  }
  if (raw.length > MUSIC_PARTS_MAX) {
    n.correction(`parts: ${raw.length} parts — only the first ${MUSIC_PARTS_MAX} are kept`);
  }
  const out: DocumentPart[] = [];
  const used = new Set<number>();
  raw.slice(0, MUSIC_PARTS_MAX).forEach((entry, i) => {
    const part = n.part(entry, `parts[${i}]`);
    if (!part) return;
    if (used.has(part.slot)) {
      n.correction(`parts[${i}]: slot ${part.slot} is already used — part dropped`);
      return;
    }
    used.add(part.slot);
    out.push(part);
  });
  return out;
}
