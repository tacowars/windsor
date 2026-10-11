/**
 * A gain that only ever moves by linear ramps of one fixed length, and that
 * remembers the ramp it is on (windsor#688, fix round for PR #693), so a new
 * ramp starts from where the old one has reached now: a reversal mid-fade
 * turns round with no step.
 *
 * The value at `now` is computed from the remembered ramp, not read from
 * `param.value`, which a browser reports as of the last render quantum and
 * which a cancel may already have moved. Once a ramp has run its course the
 * computed value is its end, so a later ramp schedules exactly what a plain
 * "hold the current value, then ramp" would.
 *
 * Main thread only. Nothing else may schedule on `param`.
 */
import { INSERT_FADE_SECONDS } from './insertConstants';

export interface FadeRamp {
  /** Ramp from the value now to `target` over one window from now. */
  to(target: number): void;
}

export function fadeRamp(
  context: BaseAudioContext,
  param: AudioParam,
  seconds = INSERT_FADE_SECONDS,
): FadeRamp {
  let from = param.value;
  let target = from;
  let start = -Infinity;
  let end = -Infinity;
  const valueAt = (time: number): number =>
    time >= end ? target : from + ((target - from) * (time - start)) / (end - start);
  return {
    to(next): void {
      const now = context.currentTime;
      const value = valueAt(now);
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
      param.linearRampToValueAtTime(next, now + seconds);
      from = value;
      target = next;
      start = now;
      end = now + seconds;
    },
  };
}
