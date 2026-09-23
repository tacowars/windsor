/**
 * Reverb spaces: the parameter set of the plate in `worklet/reverb/` (bundled
 * to `worklet/generated/reverb-processor.js`), and the named rooms the game
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
  /** Scales every tank delay: 0.05 is a box, 4 is a cathedral. */
  size: number;
  /** Tank feedback, 0..1. Sets the tail length together with `size`. */
  decay: number;
  /** All-pass coefficients inside the tank. Capped below 1 by the processor. */
  diffusionTank1: number;
  diffusionTank2: number;
  /** Hz. Damping inside the tank, applied once per loop. */
  tankLowCut: number;
  tankHighCut: number;
  /** Hz, and milliseconds, of the delay modulation that breaks up ringing. */
  modRate: number;
  modDepth: number;
}

export const DEFAULT_SPACE: ReverbSpace = {
  preDelay: 0,
  inputLowCut: 20,
  inputHighCut: 10000,
  diffusionIn1: 0.75,
  diffusionIn2: 0.625,
  size: 1,
  decay: 0.7,
  diffusionTank1: 0.7,
  diffusionTank2: 0.5,
  tankLowCut: 20,
  tankHighCut: 8000,
  modRate: 0.5,
  modDepth: 0.7,
};

/**
 * Starting points. `satisfies` rather than an annotation so the key names
 * survive: `SPACES.hall` is a `ReverbSpace`, not a possibly-undefined lookup.
 */
export const SPACES = {
  plate: makeSpace({
    size: 0.5,
    decay: 0.62,
    preDelay: 0.005,
    inputLowCut: 100,
    inputHighCut: 12000,
    tankLowCut: 120,
    tankHighCut: 7000,
    modRate: 1,
    modDepth: 0.5,
  }),
  room: makeSpace({
    size: 0.28,
    decay: 0.45,
    preDelay: 0.008,
    inputLowCut: 120,
    inputHighCut: 11000,
    tankLowCut: 150,
    tankHighCut: 5500,
    modRate: 0.4,
    modDepth: 0.3,
  }),
  hall: makeSpace({
    size: 1.4,
    decay: 0.78,
    preDelay: 0.025,
    inputLowCut: 60,
    tankLowCut: 60,
    tankHighCut: 6500,
    modDepth: 0.8,
  }),
  cathedral: makeSpace({
    size: 3,
    decay: 0.9,
    preDelay: 0.05,
    inputLowCut: 45,
    inputHighCut: 8000,
    tankLowCut: 40,
    tankHighCut: 4200,
    modRate: 0.3,
    modDepth: 1.2,
  }),
  wash: makeSpace({
    size: 2.2,
    decay: 0.95,
    inputLowCut: 90,
    inputHighCut: 6000,
    tankLowCut: 200,
    tankHighCut: 5000,
    modRate: 1.6,
    modDepth: 2.5,
  }),
  shimmer: makeSpace({
    size: 0.7,
    decay: 0.85,
    preDelay: 0.012,
    inputLowCut: 200,
    inputHighCut: 16000,
    tankLowCut: 250,
    tankHighCut: 11000,
    modRate: 2.4,
    modDepth: 1.8,
  }),
} satisfies Record<string, ReverbSpace>;

export type SpaceName = keyof typeof SPACES;

export const SPACE_NAMES = Object.keys(SPACES) as SpaceName[];

export function makeSpace(o: Partial<ReverbSpace> = {}): ReverbSpace {
  return { ...DEFAULT_SPACE, ...o };
}
