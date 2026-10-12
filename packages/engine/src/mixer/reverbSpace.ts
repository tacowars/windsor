/**
 * Reverb spaces: the parameter set of the plate in `worklet/reverb/` (bundled
 * to `worklet/generated/reverb-processor.js`), and the named rooms a return
 * picks from.
 *
 * A space is deliberately *not* part of a `Patch`. One plate is shared by every
 * part, and a patch carries only how much of itself it sends there -- that is
 * an aux send, and it is what lets several instruments sit in one room rather
 * than each in its own. The send amount lives with the part, the space lives
 * here.
 *
 * Field names and ranges mirror the processor's `parameterDescriptors`
 * exactly; `reverbSpace.test.ts` asserts the two cannot drift.
 */

export interface ReverbSpace {
  /** Seconds before the plate hears the input at all. */
  preDelay: number;
  /** Hz. Input shaping, before the diffusers. */
  inputLowCut: number;
  inputHighCut: number;
  /** All-pass coefficients of the two input diffuser pairs, 0..1. */
  diffusionIn1: number;
  diffusionIn2: number;
  /**
   * 0..1 (windsor#761): how the onset forms. 0 is dense and immediate, with
   * an early burst ahead of the tail; higher up the reverb swells in.
   */
  build: number;
  /** Scales every tank delay: 0.05 is a box, 4 is a cathedral. */
  size: number;
  /**
   * Seconds, 0.2..60: the tail's RT60, the time it takes to fall 60 dB,
   * whatever the `size` (windsor#748).
   */
  decay: number;
  /** The low band's RT60 as a multiple of `decay`, 0.25..4: 1 is one decay for every band. */
  lowDecay: number;
  /** Hz, 80..10000: where the low band hands over to `decay`. */
  lowCross: number;
  /** All-pass coefficients inside the tank. Capped below 1 by the processor. */
  diffusionTank1: number;
  diffusionTank2: number;
  /** Hz. Damping inside the tank, applied once per loop. */
  tankLowCut: number;
  tankHighCut: number;
  /** Hz, and milliseconds, of the delay modulation that breaks up ringing. */
  modRate: number;
  modDepth: number;
  /**
   * Which tables the one tank reads (windsor#746): `plate`, an instant,
   * dense onset, or `room`, distinct early reflections that grow with Size.
   * The processor reads it as its `voicing` parameter, 0 or 1
   * (`VOICING_PARAM`); a switch ducks the wet output rather than step. Not
   * automatable.
   */
  voicing: PlateVoicing;
}

/** The plate's voicings (windsor#746), in the switch's order. */
export type PlateVoicing = 'plate' | 'room';
export const PLATE_VOICINGS: readonly PlateVoicing[] = ['plate', 'room'];

/** The processor's `voicing` parameter for each voicing: 0 and 1, where 0.5 and up reads as room. */
export const VOICING_PARAM: Readonly<Record<PlateVoicing, number>> = { plate: 0, room: 1 };

export const DEFAULT_SPACE: ReverbSpace = {
  preDelay: 0,
  inputLowCut: 20,
  inputHighCut: 10000,
  diffusionIn1: 0.75,
  diffusionIn2: 0.625,
  build: 0.1,
  size: 1,
  decay: 3.35,
  lowDecay: 1,
  lowCross: 300,
  diffusionTank1: 0.7,
  diffusionTank2: 0.5,
  tankLowCut: 20,
  tankHighCut: 8000,
  modRate: 3,
  modDepth: 0.35,
  voicing: 'plate',
};

/**
 * Starting points. `satisfies` rather than an annotation so the key names
 * survive: `SPACES.hall` is a `ReverbSpace`, not a possibly-undefined lookup.
 *
 * Each `decay` is the broadband T30 the space measured before Decay became
 * seconds (windsor#748), rounded to 0.05 s, and `DEFAULT_SPACE`'s likewise:
 * `docs/research/2026-10-12-plate-decay-seconds/`. Two exceptions: at that
 * value `shimmer`'s 250 Hz tank low cut took its T30 13 % short, so it takes
 * the Decay that measures its old T30 (record
 * `2026-10-12-plate-decay-in-seconds`). Every row takes `DEFAULT_SPACE`'s
 * `build` (windsor#761). Every row is plate-voiced (windsor#746), stated in
 * each so a change to the default voicing cannot move one: item 8's bank
 * brings the room-voiced starting points. The rows are transitional: item 8
 * of `docs/research/2026-10-11-plate-reverb-upgrades/` replaces them.
 */
export const SPACES = {
  plate: makeSpace({
    size: 0.5,
    decay: 1.25,
    preDelay: 0.005,
    inputLowCut: 100,
    inputHighCut: 12000,
    tankLowCut: 120,
    tankHighCut: 7000,
    modRate: 1,
    modDepth: 0.5,
    voicing: 'plate',
  }),
  room: makeSpace({
    size: 0.28,
    decay: 0.4,
    preDelay: 0.008,
    inputLowCut: 120,
    inputHighCut: 11000,
    tankLowCut: 150,
    tankHighCut: 5500,
    modRate: 0.4,
    modDepth: 0.3,
    voicing: 'plate',
  }),
  hall: makeSpace({
    size: 1.4,
    decay: 6.35,
    preDelay: 0.025,
    inputLowCut: 60,
    tankLowCut: 60,
    tankHighCut: 6500,
    modRate: 0.5,
    modDepth: 0.8,
    voicing: 'plate',
  }),
  cathedral: makeSpace({
    size: 3,
    decay: 30.4,
    preDelay: 0.05,
    inputLowCut: 45,
    inputHighCut: 8000,
    tankLowCut: 40,
    tankHighCut: 4200,
    modRate: 0.3,
    modDepth: 1.2,
    voicing: 'plate',
  }),
  wash: makeSpace({
    size: 2.2,
    decay: 31.35,
    inputLowCut: 90,
    inputHighCut: 6000,
    tankLowCut: 200,
    tankHighCut: 5000,
    modRate: 1.6,
    modDepth: 2.5,
    voicing: 'plate',
  }),
  shimmer: makeSpace({
    size: 0.7,
    decay: 5.05,
    preDelay: 0.012,
    inputLowCut: 200,
    inputHighCut: 16000,
    tankLowCut: 250,
    tankHighCut: 11000,
    modRate: 2.4,
    modDepth: 1.8,
    voicing: 'plate',
  }),
} satisfies Record<string, ReverbSpace>;

export type SpaceName = keyof typeof SPACES;

export const SPACE_NAMES = Object.keys(SPACES) as SpaceName[];

export function makeSpace(o: Partial<ReverbSpace> = {}): ReverbSpace {
  return { ...DEFAULT_SPACE, ...o };
}
