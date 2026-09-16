/**
 * The #69b arrangement, as a TypeScript literal in the version-2 shape
 * (#597) — the data `arrangements/bed-01.json` holds.
 *
 * Two jobs:
 *
 * - a known-good, fully-populated arrangement for the player, apply and
 *   render tests: four parts on slots 0–3, one of each pitched kind and two
 *   Euclidean, with `FULL_SLOT` naming them so tests need no lookups;
 * - the pin for `arrangementEquality.test.ts`, which asserts the committed
 *   JSON still normalises to exactly this — the "sounds identical to what the
 *   maintainer approved by ear" guarantee.
 *
 * When the committed arrangement is deliberately re-authored (the #70
 * console), update this copy in the same PR: the diff is the review.
 */
import type { Arrangement, ArpSpec, EuclideanSpec, MusicPart, StepSpec } from '../arrangement';
import type { ArrangementDocument, DocumentPart } from '../arrangementDocument';
import type { ChannelStrip } from '../mix';
import type { Patch } from '../patch';
import { clonePatch } from '../patch';
import { PRESETS } from '../presets';

/** The slots bed-01's parts sit on — the retired four-slot ids' generator indices. */
export const FULL_SLOT = { kick: 0, hat: 1, arp: 2, drone: 3 } as const;
export type FullPartId = keyof typeof FULL_SLOT;
export const FULL_PART_IDS = Object.keys(FULL_SLOT) as FullPartId[];

const KICK: MusicPart & { sequencer: EuclideanSpec } = {
  slot: FULL_SLOT.kick,
  name: 'kick',
  preset: 'kick',
  velocity: 1,
  sequencer: {
    kind: 'euclidean',
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
  sequencer: {
    kind: 'euclidean',
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

const ARP: MusicPart & { sequencer: ArpSpec } = {
  slot: FULL_SLOT.arp,
  name: 'arp',
  preset: 'saw-arp',
  velocity: 0.7,
  sequencer: {
    kind: 'arp',
    divisor: 6,
    poolSize: 4,
    refreshBars: 4,
    walk: 'updown',
    skipChance: 0.3,
    register: { octave: 1, span: 2 },
    gate: 0.6,
    pattern: null,
  },
};

const DRONE: MusicPart & { sequencer: StepSpec } = {
  slot: FULL_SLOT.drone,
  name: 'drone',
  preset: 'drone-sqr',
  velocity: 0.8,
  sequencer: { kind: 'step', divisor: 96, gate: 1, register: { octave: -1, span: 1 }, pattern: null },
};

/** Each part by its retired id, typed with its kind so tests need no guards. */
export const FULL_PARTS = { kick: KICK, hat: HAT, arp: ARP, drone: DRONE } as const;

export const FULL_ARRANGEMENT: Arrangement = {
  seed: 204,
  bpm: 96,
  key: { root: 50, scale: 'dorian', weights: [4, 1, 2, 2, 3, 1, 2] },
  parts: [KICK, HAT, ARP, DRONE],
};

/** The strips bed-01's parts carry — the `MIX` entries they had before #597. */
export const FULL_STRIPS: Readonly<Record<FullPartId, ChannelStrip>> = {
  kick: { level: 0.9, pan: 0, sends: {} },
  hat: { level: 0.6, pan: 0.2, sends: { echo: 0.2 } },
  arp: { level: 0.7, pan: -0.15, sends: { room: 0.3 } },
  drone: { level: 0.8, pan: 0, sends: { room: 0.45 } },
};

/**
 * The same arrangement as a self-contained *document* (#562, #597): each part
 * with its strip, and the four patches its parts play, embedded, exactly as
 * `arrangements/bed-01.json` carries them.
 *
 * The snapshot is read from the library rather than spelled out, so this
 * fixture has no hand-copied patch numbers to drift. A ticket that
 * deliberately re-tunes one of these four library patches makes the equality
 * test fail, which is the intended alarm — it is the moment someone decides
 * whether bed-01 re-embeds the new patch or keeps the one tacowars approved by ear
 * (#564 decision 2). Any other library patch may be tuned freely.
 */
export const FULL_DOCUMENT: ArrangementDocument & {
  readonly parts: readonly DocumentPart[];
  readonly patches: Readonly<Record<string, Patch>>;
} = {
  version: 2,
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

/** The arrangement with only the named parts kept, in bed-01 order. */
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
