/**
 * Bounce to Roll's render tunables (windsor#740, record
 * `2026-10-11-bounce-to-roll` decision 4): the kinds a bounce renders, the
 * gap an envelope's step change leaves before its onset, and the float
 * noise under which a position counts as a whole tick. Data only.
 */
import type { SequencerKind } from './arrangement';

/** The kinds that generate their notes, and so bounce (decision 1): never `roll` or `none`. */
export const BOUNCE_KINDS: readonly SequencerKind[] = [
  'euclidean',
  'grid',
  'chord',
  'arp',
  'bass',
  'figure',
];

/**
 * Where a step-mod envelope's old value ends before the onset that changes
 * it: 1/64 tick, a binary fraction exact in a double and in JSON at any
 * tick, and under one 128-frame block at 48 kHz at every tempo above 15 BPM.
 */
export const BOUNCE_ENVELOPE_STEP_TICKS = 1 / 64;

/**
 * Ticks of float noise under which a played position is a whole tick, and
 * two candidate ticks are equally near (a tie, which goes to the later). The
 * clock sums its seconds tick by tick, so a whole tick comes back off by far
 * less than this.
 */
export const BOUNCE_TICK_EPSILON = 1e-6;
