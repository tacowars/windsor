/**
 * How the Echo's loop time moves (windsor#816, record
 * `2026-10-16-echo-follows-song-tempo` decision 3, which tacowars set in
 * review): every change outside a lane slews, as a tape delay repitches. A
 * tempo change, a note value change, the free Time knob, and Sync turned on
 * or off each ramp the line's `delayTime` linearly, from where it is now to
 * the new time, over `ECHO_TIME_SLEW_S`. A change mid-ramp turns from where
 * the ramp has reached, with no step: the value now is worked out from the
 * ramp the slew remembers, as `fadeRamp.ts` does, and pinned with `holdAt`
 * before the next ramp is scheduled (windsor#694).
 *
 * A Time lane writes its own curve through its handle and is not slewed.
 * When it gives the param back (turned off or deleted, or gone inert because
 * Sync was turned on), the line slews from the lane's value there to the
 * knob's time (`slewedTimeHandle`), so Sync on over an engaged lane ramps
 * instead of jumping.
 *
 * The switch's wait reads the line's time (`echoSwitchSettle.ts`), and Delay
 * Time's own reader reports where the loop is headed. While a slew runs,
 * `reader` raises it to the longest time the slew passes through, the larger
 * of its start and its target: a 1/1 shortened to 1/32T still holds
 * pre-switch audio a whole note back until its ramp is over. Once the ramp
 * is over, the reader's own value stands.
 *
 * Until the audio clock has moved since the stage was built, the line has
 * been fed nothing, so a time written then is set, not slewed: the song's
 * tempo, which reaches a new stage right after it is created
 * (`tempoInsertRegistry.ts`), starts its loop on the beat.
 */
import { DELAY_MAX_SECONDS } from '../audioConstants';
import type { AutomationHandle } from '../automation/automationHandles';
import { holdAt } from '../mixer/audibleGate';
import { ECHO_TIME_SLEW_S } from './echoConstants';
import type { FieldReader } from './switchTimeline';

/** Where an Echo's time is written: the loop's param, the audio clock, and whether a lane holds it. */
export interface EchoTimeParam {
  readonly param: AudioParam;
  readonly now: () => number;
  /** True while a Time lane holds the param: the slew leaves it to the lane. */
  readonly held: () => boolean;
  /** The time the param holds when the slew is made. */
  readonly initial: number;
}

/** One ramp the slew scheduled: from `from` at `start` to `to` at `end`. */
interface Ramp {
  readonly start: number;
  /** Cut short where a lane took the param. */
  end: number;
  readonly from: number;
  readonly to: number;
}

export interface EchoTimeSlew {
  /** Slew to `seconds` from where the line is now; nothing while a lane holds it, or when it is already headed there. */
  to(seconds: number): void;
  /** A lane gave the param back at `time`, where it held `from`: slew from there to `seconds`. */
  released(seconds: number, time: number, from: number): void;
  /** A lane took the param at `time`: from there on, the line plays the lane, not a slew. */
  taken(time: number): void;
  /** `base`, Delay Time's reader, raised to the longest time of each slew running at the time read. */
  reader(base: FieldReader): FieldReader;
}

export function echoTimeSlew(time: EchoTimeParam, seconds = ECHO_TIME_SLEW_S): EchoTimeSlew {
  const { param } = time;
  const born = time.now();
  let ramps: Ramp[] = [];
  let last: Ramp = { start: born, end: born, from: time.initial, to: time.initial };
  const valueAt = (t: number): number =>
    t >= last.end
      ? last.to
      : last.from + ((last.to - last.from) * (t - last.start)) / (last.end - last.start);
  const ramp = (from: number, to: number, now: number): void => {
    if (now === born) {
      holdAt(param, now, to);
      last = { start: now, end: now, from: to, to };
      return;
    }
    holdAt(param, now, from);
    param.linearRampToValueAtTime(to, now + seconds);
    last = { start: now, end: now + seconds, from, to };
    // A ramp over for longer than the line's 5 s left nothing the line can still read.
    ramps = ramps.filter((r) => r.end > now - DELAY_MAX_SECONDS);
    ramps.push(last);
  };
  /** The longest time of the ramps running at `t`, or just before it when `approaching`. */
  const longest = (t: number, approaching: boolean): number => {
    let most = -Infinity;
    for (const r of ramps) {
      if (approaching ? t <= r.end : t < r.end) most = Math.max(most, r.from, r.to);
    }
    return most;
  };
  return {
    to(target): void {
      if (time.held() || target === last.to) return;
      const now = time.now();
      ramp(valueAt(now), target, now);
    },
    released(target, at, from): void {
      ramp(from, target, at);
    },
    taken(at): void {
      for (const r of ramps) r.end = Math.min(r.end, at);
    },
    reader(base): FieldReader {
      const times = (): number[] =>
        [...base.times(), ...ramps.map((r) => r.end)].sort((a, b) => a - b);
      return {
        times,
        lastBefore: (t) => times().reduce((found, x) => (x < t ? x : found), -Infinity),
        jumpsAt: (t) => base.jumpsAt(t),
        at: (t) => Math.max(base.at(t), longest(t, false)),
        approaching: (t) => Math.max(base.approaching(t), longest(t, true)),
      };
    },
  };
}

/**
 * Delay Time's lane handle, `own`, whose give-back slews (Codex P1 on PR
 * #817): a lane's first hold or schedule takes the line from the slew, and
 * its release, which sets the knob's time at once, is followed by a slew from
 * the lane's value there. `resting` is the time the knob plays.
 */
export function slewedTimeHandle(
  own: AutomationHandle,
  param: AudioParam,
  slew: EchoTimeSlew,
  resting: () => number,
): AutomationHandle {
  return {
    schedule(value, time, how): void {
      slew.taken(time);
      own.schedule(value, time, how);
    },
    cancelFrom: (time) => own.cancelFrom(time),
    hold(value, time): void {
      slew.taken(time);
      own.hold(value, time);
    },
    release(time): void {
      // Read before any cancel, as `holdAt` does: Firefox reads the timeline as it stands.
      const from = param.value;
      own.release(time);
      slew.released(resting(), time, from);
    },
  };
}
