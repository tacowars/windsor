/**
 * The Echo's time against the song's tempo (windsor#816, record
 * `2026-10-16-echo-follows-song-tempo`). Synced, the loop plays a note value
 * of `DELAY_DIVISIONS` (Dub Delay's table, beats per note value) at the
 * song's BPM; free, it plays `delayTime`, which a synced Echo keeps so that
 * turning Sync off brings it back.
 *
 * The loop moves to a new time by a slew (`echoTimeSlew.ts`).
 */
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { DELAY_DIVISIONS } from './delayConstants';
import { ECHO_BOUNDS, ECHO_DEFAULT_BPM } from './echoConstants';

/** A note value of `DELAY_DIVISIONS`: `D` dotted, `T` triplet. */
export type EchoDivision = keyof typeof DELAY_DIVISIONS;

/** What sets the time an Echo's loop plays. */
export interface EchoTiming {
  /** Seconds: the free time, kept while synced. */
  readonly delayTime: number;
  /** Whether the time follows the song's tempo, at `division`. */
  readonly sync: boolean;
  readonly division: EchoDivision;
}

/**
 * The seconds the loop plays for `timing` at `bpm`: the note value's length
 * while synced, at most the line's 5 s, else the free time. A BPM that is
 * not a positive number reads `ECHO_DEFAULT_BPM`.
 */
export function echoSeconds(timing: EchoTiming, bpm: number): number {
  if (!timing.sync) return timing.delayTime;
  const tempo = Number.isFinite(bpm) && bpm > 0 ? bpm : ECHO_DEFAULT_BPM;
  const [min, max] = ECHO_BOUNDS.delayTime;
  const seconds = (SECONDS_PER_MINUTE * DELAY_DIVISIONS[timing.division]) / tempo;
  return Math.min(max, Math.max(min, seconds));
}
