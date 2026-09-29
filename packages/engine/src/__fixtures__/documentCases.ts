/**
 * The document normaliser's shared cases (#705): a silent part and a
 * one-bar play-through to prove a normalised document builds a player, the
 * embedded-`{}` patches a case's parts resolve against, and the version-3
 * shell — every part live for the whole default-length song unless it
 * writes its own regions. Read by `arrangementDocument.test.ts` and
 * `arrangementDocumentV3.test.ts`.
 */
import { DEFAULT_BARS } from '../audioConstants';
import { TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import type { Arrangement } from '../song/arrangement';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { ArrangementPlayer, type PlayablePart } from '../song/arrangementPlayer';
import type { PresetTable } from '../song/arrangementValidate';

export const silentPart = (): PlayablePart => ({
  noteOn: () => 0,
  noteOffByNote: () => {},
  trigger: () => 0,
  setPatch: () => {},
  allNotesOff: () => {},
});

/** The document's own patches — the only table playback resolves against (#562). */
export const patchesOf = (arrangement: Arrangement): PresetTable =>
  (arrangement as ArrangementDocument).patches ?? {};

/** Building and running the player is the "usable" proof: no constructor throws. */
export function play(arrangement: Arrangement): void {
  const parts = new Map(arrangement.parts.map((p) => [p.slot, silentPart()]));
  const transport = new TickTransport();
  const player = new ArrangementPlayer(transport, parts, arrangement, patchesOf(arrangement));
  for (let i = 0; i < TICKS_PER_BAR; i++) transport.advance(0);
  player.dispose();
}

/**
 * The library ids these normalisation cases name, embedded as `{}` — which
 * `patchNormalise` completes from `makePatch()` without a correction. Since
 * #562 a document resolves only its own `patches`, so a case about clamping
 * or defaults has to carry the patches its parts play.
 */
export const PATCHES = { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} };

/** The whole default-length song: the one ∞ region a case's parts live in unless it writes its own. */
export const ALL = [{ start: 0, duration: DEFAULT_BARS * TICKS_PER_BAR }];

/** A part live for the whole song, unless it names its regions (or is not an object at all). */
export const live = (part: unknown): unknown =>
  typeof part === 'object' && part !== null && !('regions' in part)
    ? { regions: ALL, ...part }
    : part;

/** A version-3 document carrying `PATCHES` and the given parts, each live for the whole song. */
export const song = (
  parts: unknown[],
  rest: Record<string, unknown> = {},
): Record<string, unknown> => ({
  version: 3,
  patches: PATCHES,
  parts: parts.map(live),
  ...rest,
});

export const KICK = {
  slot: 0,
  name: 'kick',
  preset: 'kick',
  regions: ALL,
  sequencer: { kind: 'euclidean', seed: 0 },
};

/**
 * Two chord performances (windsor#73), each complete and correction-free as
 * written: a close whole-bar pad, and a spread, half-gated eighth-note
 * figure an octave up with an inversion. `REGION_PATTERN_CHORD` plays one
 * per region.
 */
export const CHORD_PATTERN_A = {
  kind: 'chord',
  divisor: TICKS_PER_BAR,
  gate: 1,
  voicing: 'close',
  register: { octave: 3 },
  steps: [{ kind: 'hit', duration: 1, repeat: 1, inversion: 0, octave: 0 }],
};
export const CHORD_PATTERN_B = {
  kind: 'chord',
  divisor: TICKS_PER_BAR / 8,
  gate: 0.5,
  voicing: 'spread',
  register: { octave: 4 },
  steps: [
    { kind: 'hit', duration: 1, repeat: 2, inversion: 1, octave: 0 },
    { kind: 'rest', duration: 2, repeat: 1 },
  ],
};

/**
 * A chord part whose two regions each carry their own pattern (windsor#73):
 * bars 1–2 play `CHORD_PATTERN_A`, bars 3–4 `CHORD_PATTERN_B`, and the
 * part's own `sequencer` (a blank chord part) is what neither region plays.
 */
export const REGION_PATTERN_CHORD = {
  slot: 1,
  name: 'chords',
  preset: 'drone-sqr',
  regions: [
    { start: 0, duration: 2 * TICKS_PER_BAR, pattern: CHORD_PATTERN_A },
    { start: 2 * TICKS_PER_BAR, duration: 2 * TICKS_PER_BAR, pattern: CHORD_PATTERN_B },
  ],
  sequencer: {
    kind: 'chord',
    divisor: TICKS_PER_BAR,
    gate: 1,
    voicing: 'close',
    register: { octave: 3 },
    steps: [],
  },
};
