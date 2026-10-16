/**
 * The Echo insert's tunables (windsor#171): the echo return's ranges, and
 * the line a new Echo starts with: the numbers the `echo` return ran before
 * the send buses held chains (windsor#172). Its free time, 280 ms, is the
 * return's; a new Echo plays synced at `ECHO_DIVISION_DEFAULT` instead
 * (windsor#816, record `2026-10-16-echo-follows-song-tempo`).
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
import type { DELAY_DIVISIONS } from './delayConstants';

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

/** The note value a new Echo plays synced at (windsor#816): a dotted eighth. */
export const ECHO_DIVISION_DEFAULT: keyof typeof DELAY_DIVISIONS = '1/8D';

/** The tempo a synced Echo reads before the song's reaches it, or when the song's is not a tempo. */
export const ECHO_DEFAULT_BPM = 120;

/**
 * The time constant, in seconds, of a synced Echo's glide to a new time
 * (record `2026-10-16-echo-follows-song-tempo` decision 3): a tempo or a
 * note value change bends the repeats' pitch briefly instead of clicking.
 * Dub Delay smooths its times over the same 60 ms (`DELAY_DSP.timeSmoothSeconds`).
 */
export const ECHO_SYNC_GLIDE_S = 0.06;
