/**
 * The Tape's Wow and Flutter dials as motion amounts (windsor#818, record
 * `2026-10-16-tape-motion-on-a-square-law`): a dial value `d` from 0 to 100 drives
 * `motionMax · (d / 100) ^ motionPower`, the amount `TapeMotion` reads, from 0 at dial 0 to
 * `motionMax` (0.3) at dial 100, rising monotonically. `tapeDsp.ts` applies it to Wow and Flutter
 * while split and to the Wear macro's wow and flutter while unsplit; Dropouts keep their linear
 * `value / 100`. A dial outside 0 to 100 never reaches it: the normaliser and the processor's
 * parameter bounds (`TAPE_BOUNDS`) clamp it first. The DSP calls it only when a dial's smoothed
 * value moves, as `updateGains` calls `driveGain`. Pinned by `tapeMotionCurve.test.ts`.
 */
import { TAPE_DSP } from './tapeConstants';

/** The curve's two tunables, `TAPE_DSP`'s by default. */
export interface TapeMotionCurve {
  readonly percent: number;
  readonly motionMax: number;
  readonly motionPower: number;
}

/** The motion amount, 0 to `motionMax`, a Wow or Flutter dial value `dial` (0 to 100) drives. */
export function tapeMotionAmount(dial: number, curve: TapeMotionCurve = TAPE_DSP): number {
  return curve.motionMax * (dial / curve.percent) ** curve.motionPower;
}
