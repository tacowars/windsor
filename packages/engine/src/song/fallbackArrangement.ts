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
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { GAMEPLAY_PATCHES, GAMEPLAY_PATCH_IDS } from '../patch/gameplayPatches';
import { DEFAULT_STRIP } from '../mixer/mix';
import type { Patch } from '../patch/patch';
import { DIVISORS } from '../sequencing/scheduler';

/** The narrow type is the "one part" guarantee: exactly one Euclidean part, so no pitched generator exists. */
export const FALLBACK_ARRANGEMENT: ArrangementDocument & {
  readonly parts: readonly [DocumentPart & { readonly sequencer: EuclideanSpec }];
  readonly patches: Readonly<Record<string, Patch>>;
} = {
  version: ARRANGEMENT_VERSION,
  seed: 0,
  bpm: 120,
  // Self-contained like every other document (#562): the click carries the
  // one patch it plays, from the gameplay table the game bundles by id, so
  // the fallback needs no library either.
  patches: { [GAMEPLAY_PATCH_IDS.pickupBlip]: GAMEPLAY_PATCHES[GAMEPLAY_PATCH_IDS.pickupBlip] },
  // No pitched part exists to draw from this; it is here because a key is
  // structurally required, and it is a single root on purpose — nothing musical.
  key: { root: 60, scale: [0], weights: [1] },
  parts: [
    {
      slot: 0,
      name: 'click',
      preset: GAMEPLAY_PATCH_IDS.pickupBlip,
      velocity: 1,
      // Unity, centred, and with no sends — whatever a song's strips say.
      strip: DEFAULT_STRIP,
      sequencer: {
        kind: 'euclidean',
        note: 76,
        hold: 0.05,
        steps: 4,
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
