/**
 * The Echo's time against the song's tempo (windsor#816, record
 * `2026-10-16-echo-follows-song-tempo`). Synced, the loop plays a note value
 * of `DELAY_DIVISIONS` (Dub Delay's table, beats per note value) at the
 * song's BPM; free, it plays `delayTime`, which a synced Echo keeps so that
 * turning Sync off brings it back.
 *
 * A synced time that changes, by the tempo or the note value, glides to its
 * new value with `setTargetAtTime` over `ECHO_SYNC_GLIDE_S`: the repeats
 * bend in pitch for a moment instead of clicking. A free time is written at
 * once, as the knob and its lane always have been.
 */
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { DELAY_DIVISIONS } from './delayConstants';
import { ECHO_BOUNDS, ECHO_DEFAULT_BPM, ECHO_SYNC_GLIDE_S } from './echoConstants';

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

/** Where an Echo's time is written: the loop's param, the audio clock, and whether a lane holds it. */
export interface EchoTimeParam {
  readonly param: AudioParam;
  readonly now: () => number;
  /** True while a Time lane holds the param: the writer leaves it to the lane. */
  readonly held: () => boolean;
  /** The time the param holds when the writer is made. */
  readonly initial: number;
}

/**
 * The loop's time as `set` and `setTempo` write it: `write(seconds, glide)`
 * glides there while synced, and does nothing when the loop already plays
 * it; free, it writes the param at once. A free write after a glide cancels
 * what the glide left scheduled first.
 */
export function echoTimeWriter(time: EchoTimeParam): (seconds: number, glide: boolean) => void {
  let playing = time.initial;
  let glided = false;
  return (seconds, glide) => {
    if (time.held()) return;
    const now = time.now();
    if (glide) {
      if (seconds === playing) return;
      time.param.cancelScheduledValues(now);
      time.param.setTargetAtTime(seconds, now, ECHO_SYNC_GLIDE_S);
    } else {
      if (glided) time.param.cancelScheduledValues(now);
      time.param.value = seconds;
    }
    glided = glide;
    playing = seconds;
  };
}
