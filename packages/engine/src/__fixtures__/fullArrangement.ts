/**
 * A known-good, fully-populated arrangement in the version-3 shape (#705)
 * for the player, apply and render tests: a four-bar song in D dorian, two
 * chords (i for two bars, iv for two), four parts on slots 0–3 — two
 * Euclidean, a grid line and a Chord Player — each live for the whole song
 * (one ∞ region), with `FULL_SLOT` naming them so tests need no lookups.
 *
 * It began as the #69b song, whose committed-JSON twin
 * (`arrangementEquality.test.ts`) retired with the shipped songs in #704; the
 * slot names are that song's retired four-slot ids, kept so the tests read
 * the same. Its pitched parts were an arpeggiator and a step drone until
 * those kinds were deleted (#704, epic #703 decision 3).
 */
import type {
  Arrangement,
  ChordSpec,
  EuclideanSpec,
  GridSpec,
  MusicPart,
} from '../song/arrangement';
import type { ArrangementDocument, DocumentPart } from '../song/arrangementDocument';
import type { ChannelStrip } from '../mixer/mix';
import type { Patch } from '../patch/patch';
import { clonePatch } from '../patch/patch';
import { PRESETS } from '../patch/presets';
import { ARRANGEMENT_VERSION, LOW_CUT_MIN_HZ } from '../audioConstants';
import { hitStep } from '../sequencing/chordSequencer';
import { gridNote } from '../sequencing/gridSequencer';
import type { Region } from '../sequencing/regionClock';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

/** The fixture's slots, named by the retired four-slot ids that were their generator indices. */
export const FULL_SLOT = { kick: 0, hat: 1, arp: 2, drone: 3 } as const;
export type FullPartId = keyof typeof FULL_SLOT;
export const FULL_PART_IDS = Object.keys(FULL_SLOT) as FullPartId[];

/** The fixture song's length, and the one ∞ region every part is live in. */
export const FULL_BARS = 4;
export const FULL_SONG_TICKS = FULL_BARS * TICKS_PER_BAR;
export const FULL_REGION: Region = { start: 0, duration: FULL_SONG_TICKS };

const KICK: MusicPart & { sequencer: EuclideanSpec } = {
  slot: FULL_SLOT.kick,
  name: 'kick',
  preset: 'kick',
  velocity: 1,
  regions: [FULL_REGION],
  sequencer: {
    kind: 'euclidean',
    seed: 0,
    note: 36,
    hold: 0.2,
    steps: 16,
    divisor: 6,
    pulses: { min: 2, max: 5, start: 4 },
    rotate: 0,
    density: { kind: 'lfoBars', bars: 8, shape: 'tri' },
    pattern: null,
  },
};

const HAT: MusicPart & { sequencer: EuclideanSpec } = {
  slot: FULL_SLOT.hat,
  name: 'hat',
  preset: 'hat',
  velocity: 0.6,
  regions: [FULL_REGION],
  sequencer: {
    kind: 'euclidean',
    seed: 0,
    note: 42,
    hold: 0.08,
    steps: 16,
    divisor: 6,
    pulses: { min: 5, max: 12, start: 8 },
    rotate: 2,
    density: { kind: 'lfoBars', bars: 3, shape: 'sine' },
    pattern: null,
  },
};

/** The retired `arp` slot, now a written line (#704): eight eighths over the key. */
const ARP: MusicPart & { sequencer: GridSpec } = {
  slot: FULL_SLOT.arp,
  name: 'arp',
  preset: 'saw-arp',
  velocity: 0.7,
  regions: [FULL_REGION],
  sequencer: {
    kind: 'grid',
    seed: 0,
    divisor: 12,
    steps: [0, 2, 4, 2, 5, 4, 2, 1].map((degree) => gridNote(degree)),
    length: 8,
    skipChance: 0.3,
    accentVelocity: 0.2,
    accentMod: 0.5,
    // D4 = 62: the same notes the fixture sounded when the register was root-relative.
    register: { octave: 4 },
    lanes: [],
  },
};

/** The retired `drone` slot, now a Chord Player (#704, #705): a hit every bar over the timeline, held. */
const DRONE: MusicPart & { sequencer: ChordSpec } = {
  slot: FULL_SLOT.drone,
  name: 'drone',
  preset: 'drone-sqr',
  velocity: 0.8,
  regions: [FULL_REGION],
  sequencer: {
    kind: 'chord',
    divisor: 96,
    gate: 1,
    voicing: 'close',
    // D2 = 38: the octave below the grid line.
    register: { octave: 2 },
    steps: [hitStep(), hitStep()],
  },
};

/** Each part by its retired id, typed with its kind so tests need no guards. */
export const FULL_PARTS = { kick: KICK, hat: HAT, arp: ARP, drone: DRONE } as const;

export const FULL_ARRANGEMENT: Arrangement = {
  transport: { bpm: 96, bars: FULL_BARS },
  // D dorian (pitch class 2): i for bars 1–2, iv for bars 3–4.
  harmony: {
    root: 2,
    scale: 'dorian',
    events: [
      { start: 0, duration: 2 * TICKS_PER_BAR, degree: 0, size: 3 },
      { start: 2 * TICKS_PER_BAR, duration: 2 * TICKS_PER_BAR, degree: 3, size: 3 },
    ],
  },
  parts: [KICK, HAT, ARP, DRONE],
};

/** The fixture parts' strips — the `MIX` entries the #69b parts had before #597. */
export const FULL_STRIPS: Readonly<Record<FullPartId, ChannelStrip>> = {
  kick: { level: 0.9, pan: 0, lowCut: LOW_CUT_MIN_HZ, sends: {}, inserts: [] },
  hat: { level: 0.6, pan: 0.2, lowCut: LOW_CUT_MIN_HZ, sends: { b: 0.2 }, inserts: [] },
  arp: { level: 0.7, pan: -0.15, lowCut: LOW_CUT_MIN_HZ, sends: { a: 0.3 }, inserts: [] },
  drone: { level: 0.8, pan: 0, lowCut: LOW_CUT_MIN_HZ, sends: { a: 0.45 }, inserts: [] },
};

/**
 * The same arrangement as a self-contained *document* (#562, #597): each part
 * with its strip, and the four patches its parts play, embedded, the way a
 * shipped song under `arrangements/` carries them.
 *
 * The snapshot is read from the library rather than spelled out, so this
 * fixture has no hand-copied patch numbers to drift.
 */
export const FULL_DOCUMENT: ArrangementDocument & {
  readonly parts: readonly DocumentPart[];
  readonly patches: Readonly<Record<string, Patch>>;
} = {
  version: ARRANGEMENT_VERSION,
  ...FULL_ARRANGEMENT,
  parts: FULL_PART_IDS.map((id) => ({ ...FULL_PARTS[id], strip: FULL_STRIPS[id] })),
  patches: Object.fromEntries(
    FULL_PART_IDS.map((id) => FULL_PARTS[id].preset).map((id) => [
      id,
      clonePatch(PRESETS[id] as Patch),
    ]),
  ),
};

/** Per-id fakes as the player's slot map, for tests that record each part's calls. */
export function slotMap<P>(parts: Readonly<Record<FullPartId, P>>): Map<number, P> {
  return new Map(FULL_PART_IDS.map((id) => [FULL_SLOT[id], parts[id]]));
}

/** The arrangement with only the named parts kept, in fixture order. */
export function onlyParts(arrangement: Arrangement, ...ids: FullPartId[]): Arrangement {
  const slots = new Set<number>(ids.map((id) => FULL_SLOT[id]));
  return { ...arrangement, parts: arrangement.parts.filter((part) => slots.has(part.slot)) };
}

/** The arrangement with one part's fields replaced. */
export function withPart(
  arrangement: Arrangement,
  id: FullPartId,
  change: Partial<MusicPart>,
): Arrangement {
  return {
    ...arrangement,
    parts: arrangement.parts.map((part) =>
      part.slot === FULL_SLOT[id] ? { ...part, ...change } : part,
    ),
  };
}

/** `FULL_DOCUMENT` with one part's fields replaced, strip included. */
export function withDocumentPart(
  document: ArrangementDocument,
  id: FullPartId,
  change: Partial<DocumentPart>,
): ArrangementDocument {
  return {
    ...document,
    parts: document.parts.map((part) =>
      part.slot === FULL_SLOT[id] ? { ...part, ...change } : part,
    ),
  };
}
