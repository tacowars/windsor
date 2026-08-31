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
import type { Arrangement, ArrangementKey } from './arrangement';
import type { ArpArrangement, DroneArrangement, PercussionArrangement } from './arrangement';
import { FALLBACK_ARRANGEMENT } from './arrangement';
import { ArrangementNormaliser } from './arrangementNormalise';
import type { ChannelStrip } from './mix';

export { FALLBACK_ARRANGEMENT };

/**
 * What a committed `arrangements/<name>.json` may hold: the arrangement, plus
 * per-part strip overlays applied over the code's `MIX` at part creation and
 * through `AudioSystem.apply`.
 */
export type ArrangementDocument = Arrangement & {
  /** Strip overlays by part name; an absent strip keeps the code's `MIX` entry. */
  readonly mix?: Readonly<Record<string, ChannelStrip>>;
};

export interface MakeArrangementResult {
  document: ArrangementDocument;
  /** Field-level repairs: clamps, junk replaced by defaults, dropped keys and parts. */
  corrections: string[];
  /** Names the document mentions and the code does not define (record §5). */
  dangling: string[];
  /** False when nothing usable survived; `document` is then `FALLBACK_ARRANGEMENT`. */
  usable: boolean;
}

/**
 * Normalise a raw document (record §5). Never throws, and every value in the
 * result satisfies the generator constructors' asserted ranges, so building
 * an `ArrangementPlayer` from it cannot throw either.
 */
export function makeArrangement(raw: unknown): MakeArrangementResult {
  const n = new ArrangementNormaliser();
  const document = normalise(raw, n);
  if (!document) {
    n.correction('nothing usable survives normalisation — falling back to the metronome');
    return {
      document: FALLBACK_ARRANGEMENT,
      corrections: n.corrections,
      dangling: n.dangling,
      usable: false,
    };
  }
  return { document, corrections: n.corrections, dangling: n.dangling, usable: true };
}

/** The verify gate's predicate: usable, and naming nothing the code does not define. */
export function isShippable(result: MakeArrangementResult): boolean {
  return result.usable && result.dangling.length === 0;
}

const DOCUMENT_KEYS = ['seed', 'bpm', 'key', 'kick', 'hat', 'arp', 'drone', 'mix'];

/** Assembled field by field because the part slots and the mix are optional. */
interface MutableDocument {
  seed: number;
  bpm: number;
  key: ArrangementKey;
  kick?: PercussionArrangement;
  hat?: PercussionArrangement;
  arp?: ArpArrangement;
  drone?: DroneArrangement;
  mix?: Record<string, ChannelStrip>;
}

function normalise(raw: unknown, n: ArrangementNormaliser): ArrangementDocument | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    n.correction(`document: ${JSON.stringify(raw) ?? String(raw)} is not an object`);
    return null;
  }
  const o = raw as Record<string, unknown>;
  n.dropUnknown(o, DOCUMENT_KEYS, '');
  const kick = n.percussion(o.kick, 'kick');
  const hat = n.percussion(o.hat, 'hat');
  const arp = n.arp(o.arp);
  const drone = n.drone(o.drone);
  // No playable part left: an absent part must not be invented (record §4),
  // so this document has nothing to play and the caller falls back.
  if (!kick && !hat && !arp && !drone) return null;

  const document: MutableDocument = {
    seed: n.int(o.seed, 0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'seed'),
    bpm: n.num(o.bpm, 120, 20, 300, 'bpm'),
    key: n.key(o.key),
  };
  if (kick) document.kick = kick;
  if (hat) document.hat = hat;
  if (arp) document.arp = arp;
  if (drone) document.drone = drone;
  const mix = n.mix(o.mix);
  if (mix) document.mix = mix;
  return document;
}
