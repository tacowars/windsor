/**
 * The Echo insert's tunables (windsor#171): the echo return's ranges, which
 * and the line a new Echo starts with: the numbers the `echo` return ran
 * before the send buses held chains (windsor#172), which Send B's default
 * Echo keeps.
 */
import {
  DELAY_DAMP_MAX_HZ,
  DELAY_DAMP_MIN_HZ,
  DELAY_FEEDBACK_MAX,
  DELAY_MAX_SECONDS,
  DELAY_RESONANCE_DEFAULT_DB,
  DELAY_RESONANCE_MAX_DB,
  DELAY_RESONANCE_MIN_DB,
} from '../audioConstants';
import type { DelayLineSettings } from '../mixer/returnEffects';

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

/** The line a new Echo starts with: seconds, loop gain, Hz and dB. */
export const ECHO_LINE_DEFAULTS: DelayLineSettings = {
  delayTime: 0.28,
  feedback: 0.3,
  damp: 3200,
  resonance: DELAY_RESONANCE_DEFAULT_DB,
};

/**
 * How far the damp filter's ring must fall before a switch on reopens the
 * Echo's loop (fix round 2 for PR #635, `echoSwitchSettle.ts`): dB below
 * what it rang with.
 */
export const ECHO_RING_FLOOR_DB = 90;

/**
 * At most this many steps grow the ring's window over Damp and Resonance's
 * lanes; past them the wait is the longest ring their bounds allow.
 */
export const ECHO_RING_MAX_STEPS = 64;

/** `4` in the damp filter's pole discriminant, `a1² − 4·a2` (`echoSwitchSettle.ts`). */
export const ECHO_POLE_DISCRIMINANT_FACTOR = 4;
