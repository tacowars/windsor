/**
 * What the automation player writes through (windsor#344, record
 * `2026-10-01-song-automation-lanes` decisions 6, 8 and 9): a handle turns a
 * lane's value, in its target's units, into AudioParam events. One target may
 * drive several params, as pan drives the rotation's four gains, so the
 * player never sees a param.
 *
 * Every family of target hands the player the same interface through the
 * resolver in `system/automationResolver.ts`: the strip's handles are built
 * here and owned by the channel strip; an insert's come from
 * `inserts/insertAutomation.ts` (windsor#345) and a voice's from
 * `synth/voiceAutomation.ts` (windsor#346).
 *
 * A strip target's knob writes the same params a lane does. Its handle
 * (`knobHandle`) is engaged from the lane's first hold or schedule until its
 * release, and while it is engaged the knob only records its value, so a
 * knob never fights a lane (decision 7 of windsor#344). Releasing it gives
 * the params back to the knob's value.
 */

/** How a scheduled value is reached: linearly from the event before it, or at once. */
export type AutomationHow = 'ramp' | 'set';

/** A lane's writer onto its target's params. */
export interface AutomationHandle {
  /** Reach `value` at `time`: a linear ramp from the event before it, or a jump (`set`). */
  schedule(value: number, time: number, how: AutomationHow): void;
  /** Drop every event at or after `time`. */
  cancelFrom(time: number): void;
  /** Cancel from `time`, then hold `value` from there: a discontinuity's new start. */
  hold(value: number, time: number): void;
  /** The lane is off or gone: cancel from `time` and give the params back to their owner there. */
  release(time: number): void;
}

/** A handle on params a knob also writes. */
export interface KnobHandle extends AutomationHandle {
  /** True from a hold or schedule until the release: the knob records and does not write. */
  readonly engaged: boolean;
}

/** What a knob's handle writes. */
export interface KnobTarget {
  readonly params: readonly AudioParam[];
  /** Each param's value for a lane value, in `params` order. */
  readonly write: (value: number) => readonly number[];
  /** The knob's own value: what a release restores. */
  readonly resting: () => number;
}

/** A lane value written as itself, onto one param. */
export const sameValue = (value: number): readonly number[] => [value];

export function knobHandle(target: KnobTarget): KnobHandle {
  const { params, write, resting } = target;
  let engaged = false;
  const each = (value: number, how: AutomationHow, time: number): void => {
    const values = write(value);
    params.forEach((param, i) => {
      const v = values[i]!;
      if (how === 'ramp') param.linearRampToValueAtTime(v, time);
      else param.setValueAtTime(v, time);
    });
  };
  const cancelFrom = (time: number): void => {
    for (const param of params) param.cancelScheduledValues(time);
  };
  return {
    get engaged(): boolean {
      return engaged;
    },
    schedule(value, time, how): void {
      engaged = true;
      each(value, how, time);
    },
    cancelFrom,
    hold(value, time): void {
      engaged = true;
      cancelFrom(time);
      each(value, 'set', time);
    },
    release(time): void {
      engaged = false;
      cancelFrom(time);
      each(resting(), 'set', time);
    },
  };
}
