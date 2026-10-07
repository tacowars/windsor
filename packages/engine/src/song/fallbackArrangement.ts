/**
 * The fallback is a diagnostic click, not a musical default (record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §4): one
 * Euclidean part on a quarter-note pulse — no sends, no harmony, no
 * generative movement. It plays only when nothing usable survives
 * `makeArrangement`, and it is deliberately unmusical so it can never be
 * mistaken for the arrangement. It is also more informative than silence: a
 * click proves the context resumed, the worklets loaded, the routing works
 * and the master path is open, which narrows the fault to the document alone.
 */
import type { ArrangementDocument, DocumentPart } from './arrangementDocument';
import type { EuclideanSpec } from './arrangement';
import { ARRANGEMENT_VERSION, CHORD_SIZE_TRIAD } from '../audioConstants';
import { FALLBACK_PATCH, FALLBACK_PATCH_ID } from '../patch/fallbackPatch';
import { DEFAULT_STRIP } from '../mixer/mix';
import type { Patch } from '../patch/patch';
import { defaultStepCount, ticksPerBar } from '../sequencing/meter';
import { DIVISORS } from '../sequencing/scheduler';

/** The click's one bar, in the 4/4 a song without a meter plays (windsor#429). */
const BAR = ticksPerBar();

/** The narrow type is the "one part" guarantee: exactly one Euclidean part, so no pitched generator exists. */
export const FALLBACK_ARRANGEMENT: ArrangementDocument & {
  readonly parts: readonly [DocumentPart & { readonly sequencer: EuclideanSpec }];
  readonly patches: Readonly<Record<string, Patch>>;
} = {
  version: ARRANGEMENT_VERSION,
  transport: { bpm: 120, bars: 1 },
  // Self-contained like every other document (#562): the click carries the
  // one patch it plays, imported by id on its own, so the fallback needs no
  // library either.
  patches: { [FALLBACK_PATCH_ID]: FALLBACK_PATCH },
  // No pitched part exists to draw from this; it is here because a harmony is
  // structurally required, and it is a single root on purpose — nothing musical.
  harmony: {
    root: 0,
    scale: [0],
    events: [{ start: 0, duration: BAR, degree: 0, size: CHORD_SIZE_TRIAD }],
  },
  parts: [
    {
      slot: 0,
      name: 'click',
      colour: 0,
      preset: FALLBACK_PATCH_ID,
      velocity: 1,
      // Unity, centred, and with no sends — whatever a song's strips say.
      strip: DEFAULT_STRIP,
      // Live for the whole one-bar song: the ∞ region, entered once.
      regions: [{ start: 0, duration: BAR }],
      sequencer: {
        kind: 'euclidean',
        seed: 0,
        note: 76,
        hold: 0.05,
        // One bar of quarters (`defaultStepCount`, windsor#429 decision 5).
        steps: defaultStepCount(undefined, DIVISORS.quarter),
        divisor: DIVISORS.quarter,
        // min === max: E(4,4) fires every step and the density LFO has nothing
        // to modulate, so the pulse never varies and no RNG is consumed — the
        // one part is not generative.
        pulses: { min: 4, max: 4, start: 4 },
        rotate: 0,
        density: { kind: 'lfoBars', bars: 1, shape: 'tri' },
        // Not captured either: the pulse comes from E(4, 4), authored above.
        pattern: null,
      },
    },
  ],
};
