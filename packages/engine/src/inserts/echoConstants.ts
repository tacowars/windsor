/**
 * The Echo insert's tunables (windsor#171): the echo return's ranges, which
 * a document's `returns` section is clamped into too, and the Mix a new Echo
 * starts at. Its other defaults are the `echo` return's (`RETURNS.echo`).
 */
import {
  DELAY_DAMP_MAX_HZ,
  DELAY_DAMP_MIN_HZ,
  DELAY_FEEDBACK_MAX,
  DELAY_MAX_SECONDS,
  DELAY_RESONANCE_MAX_DB,
  DELAY_RESONANCE_MIN_DB,
} from '../audioConstants';

/** `[min, max]` per Echo number: seconds, loop gain, Hz, dB, and the wet share. */
export const ECHO_BOUNDS = {
  delayTime: [0, DELAY_MAX_SECONDS],
  feedback: [0, DELAY_FEEDBACK_MAX],
  damp: [DELAY_DAMP_MIN_HZ, DELAY_DAMP_MAX_HZ],
  resonance: [DELAY_RESONANCE_MIN_DB, DELAY_RESONANCE_MAX_DB],
  mix: [0, 1],
} as const satisfies Record<string, readonly [number, number]>;

/** A new Echo on a part or the master starts at this Mix (record `2026-09-30-insert-rack-and-send-bus-chains` §5). */
export const ECHO_MIX_DEFAULT = 0.3;
