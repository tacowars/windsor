/**
 * A param two or more insert fields share (windsor#345, fix round for PR
 * #384), or one the switch moves (windsor#629): a Drive's wet gain is its mix times the drive's compensation, a
 * Chorus's right swing its depth times the spread's share, an Ensemble's wet
 * level its mix over the width's per-side sum. A native kind's on/off switch
 * (windsor#628) joins the mix in its wet and dry gains, so a Drive's wet gain
 * reads three fields.
 *
 * The player schedules one lane's whole window before the next lane's
 * (`automation/automationPlayer.ts`), so neither lane may write the shared
 * param from the other's latest value: that may lie in the future, and a
 * step would leak back across the other lane's earlier events. Instead the
 * param's schedule is `value(A(t), B(t), …)` at every breakpoint any of its
 * fields has, where `A(t)`, `B(t)`, … are each field's own value at `t`
 * (`fieldTimeline.ts`): its lane's events, or its knob where no lane holds it.
 *
 * When any field's lane writes, the param is cancelled from the first point
 * that call can change and written again from there:
 *
 * - each point is a ramp to the fields' value there, so it follows every lane;
 * - where any field jumps (a set, a hold, a release), a ramp to the value
 *   just before, then a set to the value after, so a step stays a step.
 *
 * The list of points written is pruned with the fields', as time passes.
 *
 * The switch (windsor#629) is read through its `SwitchTimeline`'s view, never
 * as a step: each change crosses `INSERT_SWITCH_FADE_S`, so its points come
 * in pairs, the hold at the change and the ramp's end. The button's change
 * crosses too: `restAt` notes it and writes the crossing from now.
 */
import type { AutomationHow, KnobHandle } from '../automation/automationHandles';
import type { FieldTimeline } from './fieldTimeline';
import { pruneBefore } from './fieldTimeline';
import type { FieldReader, SwitchView } from './switchTimeline';
import { SwitchTimeline } from './switchTimeline';

/** One field's timeline: a continuous field's, or the switch's. */
export type LaneTimeline = FieldTimeline | SwitchTimeline;

/** What one shared param is made of. */
export interface SharedParam {
  /** The params, all written with the same value (one per voice, say). */
  readonly params: readonly AudioParam[];
  /** Its fields, one or more, in `value`'s argument order. */
  readonly fields: readonly string[];
  /** The params' value for the fields' values. */
  readonly value: (...values: number[]) => number;
  /** How it reads the switch, if it is one of `fields`: its fade unless named. */
  readonly switchView?: SwitchView;
  /**
   * For an effect that holds what it was fed (fix round 1 for PR #635): how
   * long it takes to empty after the switch's fade out ends at `offEnd`,
   * from its fields' readers in `fields` order. The switch's view then makes
   * each on wait for it (`switchCrossings.ts`'s `settledCrossings`).
   */
  readonly settle?: (offEnd: number, fields: readonly FieldReader[]) => number;
}

/** One shared param's points, written from its fields' timelines. */
export class SharedSchedule {
  /** The times of the points on the params now, in order. */
  private written: number[] = [];
  /** The last prune's time: points before it are over, and their events folded away. */
  private pruned = -Infinity;
  /** Whether any event has reached the params: from then on, a plain value write is ignored. */
  private scheduled = false;
  /** What the schedule reads of each field: the timeline, or the switch's view. */
  private readonly readers: readonly FieldReader[];
  private readonly switches: readonly SwitchTimeline[];

  /** `timelines` are the fields', in `shared.fields` order. */
  constructor(
    private readonly shared: SharedParam,
    private readonly timelines: readonly LaneTimeline[],
  ) {
    const { switchView = 'fade', settle } = shared;
    const settled = settle && ((offEnd: number): number => settle(offEnd, this.readers));
    this.readers = timelines.map((t) =>
      t instanceof SwitchTimeline ? t.view(switchView, settled) : t,
    );
    this.switches = timelines.filter((t): t is SwitchTimeline => t instanceof SwitchTimeline);
  }

  /** Whether `timeline` is one of this param's fields. */
  reads(timeline: LaneTimeline): boolean {
    return this.timelines.includes(timeline);
  }

  /**
   * Before `field` changes at `time`, the first time the change can reach:
   * the first point after `field`'s last event before `time`, since a ramp
   * there runs from that event; or `time`, if that comes first.
   */
  firstChanged(field: LaneTimeline, time: number): number {
    const after = this.readers[this.timelines.indexOf(field)]!.lastBefore(time);
    const next = this.written.find((t) => t > after);
    return next === undefined ? time : Math.min(time, next);
  }

  /**
   * Cancel the params from `from` and write every point from there again;
   * never from before the last prune (fix round 1 for PR #635). A point
   * there is over and its fields' events are folded away, so it could not be
   * written again: cancelling a ramp that ended before the prune took the
   * switch's whole fade out back with it.
   */
  rewrite(from: number): void {
    const start = Math.max(from, this.pruned);
    if (this.written.some((t) => t >= start)) this.cancel(start);
    this.writePoints((t) => t >= start);
  }

  /**
   * A knob moved at `now` (windsor#628, fix round for PR #632): write the
   * params from the fields' values now. Where no lane holds any of the
   * fields, that is a plain value write, as `set` makes. Where one does, the
   * params step to the value at `now` and every later point is written
   * again, so the edit is heard at once while the lane's points still apply.
   * So, too, while the switch crosses after `now` (windsor#629): a button
   * press is held at `now` and ramps to its end, and an edit mid-fade steps
   * to the fade's value there with the new knob, so the rest of the ramp
   * lands on the new value.
   *
   * Once the params hold any event, the edit is an event too (fix round 2
   * for PR #635): a param with events plays its last one and ignores a plain
   * value write, so after a switch's fade has ended a Mix edit would not be
   * heard.
   */
  restAt(now: number, held: boolean): void {
    for (const s of this.switches) s.noteKnob(now);
    const value = this.valueAt(now);
    if (!held && !this.crossesAfter(now) && !this.scheduled) {
      for (const param of this.shared.params) param.value = value;
      return;
    }
    this.prune(now);
    this.cancel(now);
    this.write(value, now, 'set');
    this.written.push(now);
    this.writePoints((t) => t > now);
  }

  /** Forget what is over: each field's events and the points, before the last at or before `now`. */
  prune(now: number): void {
    this.pruned = Math.max(this.pruned, now);
    for (const timeline of this.timelines) timeline.prune(now);
    pruneBefore(this.written, (t) => t, now);
  }

  /** Whether the switch has a point after `now`: a crossing still to come or under way. */
  private crossesAfter(now: number): boolean {
    return this.readers.some(
      (r, i) => this.timelines[i] instanceof SwitchTimeline && r.times().some((t) => t > now),
    );
  }

  private valueAt(time: number): number {
    return this.shared.value(...this.readers.map((r) => r.at(time)));
  }

  private cancel(from: number): void {
    for (const param of this.shared.params) param.cancelScheduledValues(from);
    this.written = this.written.filter((t) => t < from);
  }

  /** A point at every time any field has an event, of those `keep` takes. */
  private writePoints(keep: (time: number) => boolean): void {
    const times = [...new Set(this.readers.flatMap((r) => r.times()))]
      .filter(keep)
      .sort((x, y) => x - y);
    for (const time of times) this.point(time);
  }

  private point(time: number): void {
    const { value } = this.shared;
    const before = value(...this.readers.map((r) => r.approaching(time)));
    const after = this.valueAt(time);
    const first = this.written.length === 0;
    const jumps = this.readers.some((r) => r.jumpsAt(time));
    if (before !== after) {
      if (!first) this.write(before, time, 'ramp');
      this.write(after, time, 'set');
    } else {
      this.write(after, time, first && jumps ? 'set' : 'ramp');
    }
    this.written.push(time);
  }

  private write(value: number, time: number, how: AutomationHow): void {
    this.scheduled = true;
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
  timeline: LaneTimeline,
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
