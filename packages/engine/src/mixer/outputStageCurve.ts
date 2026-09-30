/**
 * The output stage's static curves (windsor#193 decision 6): what each mode
 * makes of a steady linear input magnitude, at a linear ceiling.
 *
 * - Off is the identity.
 * - Limiter and Hard clip are the identity up to the ceiling, then flat.
 *   The limiter's gain moves in time, so this is where its peaks settle; its
 *   final clamp is at the ceiling.
 * - Soft clip is the identity up to `OUTPUT_SOFT_CLIP.kneeDb` below the
 *   ceiling, then a rational curve that leaves the knee at slope 1 and
 *   approaches the ceiling without reaching it.
 *
 * The clipper's `residual` (`outputStageClipper.ts`) calls this on the audio
 * thread, twice a frame, so the DSP and the console's transfer plot share
 * one formula. It allocates nothing. `outputStageCurve.test.ts` pins it
 * against the clipper, and `outputStageGolden.test.ts` the render.
 */
import {
  DB_PER_DECADE,
  DECADE,
  OUTPUT_SOFT_CLIP,
  type OutputStageMode,
} from './outputStageConstants';

/** The soft clip's knee as a fraction of the ceiling, computed once. */
const SOFT_CLIP_KNEE_GAIN = Math.pow(DECADE, -OUTPUT_SOFT_CLIP.kneeDb / DB_PER_DECADE);

/**
 * The output magnitude for input magnitude `x` (0 or more), linear, at a
 * `ceiling` above 0. `knee` is the soft clip's, linear: the clipper passes
 * the one it was configured with, and a plot leaves it to the shipped
 * table's. Plain parameters rather than an options object, since the audio
 * thread calls this per sample and may not allocate.
 */
export function outputStageCurve(
  mode: OutputStageMode,
  ceiling: number,
  x: number,
  knee = ceiling * SOFT_CLIP_KNEE_GAIN,
): number {
  if (mode === 'off') return x;
  if (mode !== 'soft') return x <= ceiling ? x : ceiling;
  if (x <= knee) return x;
  const u = (x - knee) / (ceiling - knee);
  return knee + ((ceiling - knee) * u) / (1 + u);
}
