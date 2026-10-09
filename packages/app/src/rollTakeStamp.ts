/**
 * When a played note was heard (windsor#662, record `2026-10-09-roll-recording`
 * decision 3): an input event's `timeStamp` mapped to the AudioContext time
 * that was coming out of the speakers at that moment. The caller passes the
 * result to the scheduler's `audibleTick`, so the note is stamped at the tick
 * tacowars heard, not the one the scheduler was queueing ahead.
 *
 * Web MIDI and DOM events both stamp `timeStamp` in performance time (ms).
 * `getOutputTimestamp()` pairs the context time being heard at the output
 * with the performance time it was heard at (the Web Audio spec's definition,
 * so the output latency is already in it). Before the output has run, a
 * browser reports the pair missing or as zeros, and the stamp falls back to
 * the context's own clock, which renders ahead of what is heard by
 * `outputLatency`.
 */

const MS_PER_SECOND = 1000;

/** A `getOutputTimestamp()` reading: either field may be missing, as the DOM type allows. */
export interface OutputReading {
  readonly contextTime?: number;
  readonly performanceTime?: number;
}

/** What the stamp reads of the AudioContext at the event. */
export interface StampClock {
  /** `context.getOutputTimestamp()`. */
  readonly output: OutputReading | undefined;
  /** `context.outputLatency`, in seconds, for the fallback only; a browser without it passes undefined. */
  readonly outputLatency: number | undefined;
  /** `context.currentTime`, the fallback. */
  readonly currentTime: number;
}

/**
 * The context time heard at performance time `timeStamp` (ms):
 * `contextTime + (timeStamp − performanceTime) / 1000`, or, with no usable
 * output reading, `currentTime − outputLatency`.
 */
export function heardContextTime(timeStamp: number, clock: StampClock): number {
  const { contextTime, performanceTime } = clock.output ?? {};
  if (contextTime === undefined || !performanceTime) {
    return clock.currentTime - (clock.outputLatency ?? 0);
  }
  return contextTime + (timeStamp - performanceTime) / MS_PER_SECOND;
}
