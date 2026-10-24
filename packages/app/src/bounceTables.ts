/**
 * Bounce to Roll's words and kinds in the console (windsor#742, record
 * `2026-10-11-bounce-to-roll` decisions 1, 2, 6 and 8, and the approved
 * mockup `docs/research/2026-10-11-bounce-to-roll-mockup/mockup.html`).
 * Data only: `bounceToastModel.ts` builds the sentences from it.
 */
import type { Meter, SeqField, SequencerKind } from '@windsor/engine';

/**
 * The kinds the button shows on (decision 1): the six that generate their
 * notes, never `roll` or `none`. The engine's own list is not in its index;
 * `bounceButtonModel.test.ts` pins this one to it.
 */
export const BOUNCE_KINDS: readonly SequencerKind[] = [
  'euclidean',
  'grid',
  'chord',
  'arp',
  'bass',
  'figure',
];

/** The button's label and titles, and the undo step's name (decision 2). */
export const BOUNCE_BUTTON = {
  label: 'Bounce to Roll',
  title: 'Rewrite every region of this part as a Roll of the notes it plays. One undo step.',
  noRegions: 'No regions to bounce',
  undo: 'Bounce to Roll',
} as const;

/** One count's wording: the noun phrase for 1, and for any other number. */
export interface CountWords {
  readonly one: string;
  readonly many: string;
}

/** Which summary count a line reads. */
export type BounceCount =
  | 'ticksRounded'
  | 'ratchetHitsLost'
  | 'accentsLostMod'
  | 'repeatsTrimmed'
  | 'euclidTailsCut'
  | 'silenced';

/**
 * Decision 8's approximations, in its order and wording, each shown only
 * when not zero. Notes silenced at velocity 0 are the record's boundary case
 * ("5 notes at velocity 0 silenced"); they come before the lanes. Since
 * windsor#755 (record `2026-10-12-roll-note-accent-and-ratchet` decision
 * 11) the engine counts the ratchet and accent lines only for its
 * fallbacks: a ratchet written as its hits, and an accent baked in.
 */
export const BOUNCE_COUNT_LINES: readonly (readonly [BounceCount, CountWords])[] = [
  ['ticksRounded', { one: 'tick rounded', many: 'ticks rounded' }],
  ['ratchetHitsLost', { one: 'ratchet hit lost', many: 'ratchet hits lost' }],
  ['accentsLostMod', { one: 'accent lost its mod', many: 'accents lost their mod' }],
  ['repeatsTrimmed', { one: 'repeat trimmed', many: 'repeats trimmed' }],
  [
    'euclidTailsCut',
    { one: "Euclid tail cut at a region's end", many: "Euclid tails cut at a region's end" },
  ],
  ['silenced', { one: 'note at velocity 0 silenced', many: 'notes at velocity 0 silenced' }],
];

/**
 * The sequencer lanes a bounce bakes, named as their knobs are, in the
 * record's order ("Skip and Gate"), Randomness and Probability (windsor#935)
 * after them.
 */
export const BOUNCE_LANE_NAMES: readonly (readonly [SeqField, string])[] = [
  ['skipChance', 'Skip'],
  ['gate', 'Gate'],
  ['density', 'Density'],
  ['randomness', 'Randomness'],
  ['probability', 'Probability'],
];

/** The meter the loop cap is stated in: "256 bars of 4/4" (decision 6). */
export const BOUNCE_CAP_METER: Meter = '4/4';

/** The toasts' fixed words. */
export const BOUNCE_TOAST = {
  bounced: 'Bounced to Roll',
  note: { one: 'note', many: 'notes' },
  region: { one: 'region', many: 'regions' },
  separator: ' · ',
  splitFirst: 'Split it first.',
} as const;
