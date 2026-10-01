/**
 * A param two insert fields share (windsor#345, fix round for PR #384): a
 * Drive's wet gain is its mix times the drive's compensation, a Chorus's
 * right swing its depth times the spread's share, an Ensemble's wet level
 * its mix over the width's per-side sum.
 *
 * The player schedules one lane's whole window before the next lane's
 * (`automation/automationPlayer.ts`), so neither lane may write the shared
 * param from the other's latest value: that may lie in the future, and a
 * step would leak back across the other lane's earlier events. Instead the
 * param's schedule is `value(A(t), B(t))` at every breakpoint either field
 * has, where `A(t)` and `B(t)` are each field's own value at `t`
 * (`fieldTimeline.ts`): its lane's events, or its knob where no lane holds it.
 *
 * When either field's lane writes, the param is cancelled from the first
 * point that call can change and written again from there:
 *
 * - each point is a ramp to the pair's value there, so it follows both lanes;
 * - where either field jumps (a set, a hold, a release), a ramp to the value
 *   just before, then a set to the value after, so a step stays a step.
 *
 * The list of points written is pruned with the fields', as time passes.
 */
import type { AutomationHow, KnobHandle } from '../automation/automationHandles';
import type { FieldTimeline } from './fieldTimeline';
import { pruneBefore } from './fieldTimeline';

/** What one shared param is made of. */
export interface SharedParam {
  /** The params, all written with the same value (one per voice, say). */
  readonly params: readonly AudioParam[];
  /** The two fields, in `value`'s argument order. */
  readonly fields: readonly [string, string];
  /** The params' value for the two fields' values. */
  readonly value: (a: number, b: number) => number;
}

/** One shared param's points, written from its two fields' timelines. */
export class SharedSchedule {
  /** The times of the points on the params now, in order. */
  private written: number[] = [];

  constructor(
    private readonly shared: SharedParam,
    private readonly a: FieldTimeline,
    private readonly b: FieldTimeline,
  ) {}

  /** Whether `timeline` is one of this param's fields. */
  reads(timeline: FieldTimeline): boolean {
    return timeline === this.a || timeline === this.b;
  }

  /**
   * Before `field` changes at `time`, the first time the change can reach:
   * the first point after `field`'s last event before `time`, since a ramp
   * there runs from that event; or `time`, if that comes first.
   */
  firstChanged(field: FieldTimeline, time: number): number {
    const after = field.lastBefore(time);
    const next = this.written.find((t) => t > after);
    return next === undefined ? time : Math.min(time, next);
  }

  /** Cancel the params from `from` and write every point from there again. */
  rewrite(from: number): void {
    if (this.written.some((t) => t >= from)) {
      for (const param of this.shared.params) param.cancelScheduledValues(from);
      this.written = this.written.filter((t) => t < from);
    }
    const times = [...new Set([...this.a.times(), ...this.b.times()])]
      .filter((t) => t >= from)
      .sort((x, y) => x - y);
    for (const time of times) this.point(time);
  }

  /** Forget what is over: each field's events and the points, before the last at or before `now`. */
  prune(now: number): void {
    this.a.prune(now);
    this.b.prune(now);
    pruneBefore(this.written, (t) => t, now);
  }

  private point(time: number): void {
    const { value } = this.shared;
    const before = value(this.a.approaching(time), this.b.approaching(time));
    const after = value(this.a.at(time), this.b.at(time));
    const first = this.written.length === 0;
    const jumps = this.a.jumpsAt(time) || this.b.jumpsAt(time);
    if (before !== after) {
      if (!first) this.write(before, time, 'ramp');
      this.write(after, time, 'set');
    } else {
      this.write(after, time, first && jumps ? 'set' : 'ramp');
    }
    this.written.push(time);
  }

  private write(value: number, time: number, how: AutomationHow): void {
    for (const param of this.shared.params) {
      if (how === 'ramp') param.linearRampToValueAtTime(value, time);
      else param.setValueAtTime(value, time);
    }
  }
}

/**
 * `own`, the field's handle on the params only it writes, wrapped so each
 * call also lands on the field's timeline and rewrites every shared param
 * that reads it. `now` is the audio clock, for pruning.
 */
export function sharedFieldHandle(
  own: KnobHandle,
  timeline: FieldTimeline,
  schedules: readonly SharedSchedule[],
  now: () => number,
): KnobHandle {
  const mine = schedules.filter((s) => s.reads(timeline));
  const change = (time: number, edit: () => void): void => {
    const at = now();
    for (const s of mine) s.prune(at);
    const from = mine.map((s) => s.firstChanged(timeline, time));
    edit();
    mine.forEach((s, i) => s.rewrite(from[i]!));
  };
  return {
    get engaged(): boolean {
      return own.engaged;
    },
    schedule(value, time, how): void {
      own.schedule(value, time, how);
      change(time, () => timeline.schedule(value, time, how));
    },
    cancelFrom(time): void {
      own.cancelFrom(time);
      change(time, () => timeline.cancelFrom(time));
    },
    hold(value, time): void {
      own.hold(value, time);
      change(time, () => timeline.hold(value, time));
    },
    release(time): void {
      own.release(time);
      change(time, () => timeline.release(time));
    },
  };
}
