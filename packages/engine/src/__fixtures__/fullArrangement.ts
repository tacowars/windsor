/**
 * The #69b `ARRANGEMENT`, verbatim, as a TypeScript literal — the data
 * `arrangements/bed-01.json` was serialised from when #75 moved the
 * arrangement out of code.
 *
 * Two jobs:
 *
 * - a known-good, fully-populated arrangement for the player, apply and
 *   render tests, typed with all four parts required so tests need no guards;
 * - the pin for `arrangementEquality.test.ts`, which asserts the committed
 *   JSON still normalises to exactly this — the "sounds identical to what the
 *   maintainer approved by ear" guarantee.
 *
 * When the committed arrangement is deliberately re-authored (the #70
 * console), update this copy in the same PR: the diff is the review.
 */
import type {
  ArpArrangement,
  Arrangement,
  DroneArrangement,
  PercussionArrangement,
} from '../arrangement';

/** An arrangement with every part slot populated. */
export type FullArrangement = Arrangement & {
  readonly kick: PercussionArrangement;
  readonly hat: PercussionArrangement;
  readonly arp: ArpArrangement;
  readonly drone: DroneArrangement;
};

export const FULL_ARRANGEMENT: FullArrangement = {
  seed: 204,
  bpm: 96,
  key: { root: 50, scale: 'dorian', weights: [4, 1, 2, 2, 3, 1, 2] },
  kick: {
    part: 'kick',
    preset: 'kick',
    note: 36,
    velocity: 1,
    hold: 0.2,
    driver: {
      steps: 16,
      divisor: 6,
      pulses: { min: 2, max: 5, start: 4 },
      rotate: 0,
      density: { kind: 'lfoBars', bars: 8, shape: 'tri' },
    },
  },
  hat: {
    part: 'hat',
    preset: 'hat',
    note: 42,
    velocity: 0.6,
    hold: 0.08,
    driver: {
      steps: 16,
      divisor: 6,
      pulses: { min: 5, max: 12, start: 8 },
      rotate: 2,
      density: { kind: 'lfoBars', bars: 3, shape: 'sine' },
    },
  },
  arp: {
    part: 'arp',
    preset: 'saw-arp',
    velocity: 0.7,
    driver: {
      divisor: 6,
      poolSize: 4,
      refreshBars: 4,
      walk: 'updown',
      skipChance: 0.3,
      register: { octave: 1, span: 2 },
      gate: 0.6,
    },
  },
  drone: {
    part: 'drone',
    preset: 'drone-sqr',
    velocity: 0.8,
    driver: { divisor: 96, gate: 1, register: { octave: -1, span: 1 } },
  },
};
