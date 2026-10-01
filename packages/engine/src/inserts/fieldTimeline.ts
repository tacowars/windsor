/**
 * One insert field's own value over time, as its lane scheduled it
 * (windsor#345, fix round for PR #384): the events a lane's handle put on the
 * field, kept in Web Audio's order, so a param two fields share can be
 * written from each field's value at the same moment
 * (`sharedParamSchedule.ts`).
 *
 * - Events sit in time order, equal times in call order; a cancel drops every
 *   event at or after its time, as `cancelScheduledValues` does.
 * - Between two events the value holds, or runs linearly when the later one
 *   is a ramp. Before the first event it is the knob's (`resting`), or a
 *   first ramp's own value, since a ramp with nothing before it has no start.
 * - A release is a jump back to the knob, read live: from there on the field
 *   is the spec's value, whatever the knob does next.
 * - `prune(now)` drops what is over, keeping the last event at or before
 *   `now` as the anchor, so the list stays as long as the look-ahead.
 *
 * Main thread only: it allocates freely.
 */
import type { AutomationHow } from '../automation/automationHandles';

interface FieldEvent {
  readonly time: number;
  readonly value: number;
  readonly how: AutomationHow;
  /** A release: the knob's value, read when asked. */
  readonly rest: boolean;
}

export class FieldTimeline {
  private events: FieldEvent[] = [];

  /** `resting` is the knob's value now: the field's value with no lane. */
  constructor(private readonly resting: () => number) {}

  /** Every event's time, in order. */
  times(): number[] {
    return this.events.map((e) => e.time);
  }

  /** The time of the last event before `time`; -Infinity for none. */
  lastBefore(time: number): number {
    let last = -Infinity;
    for (const e of this.events) if (e.time < time) last = e.time;
    return last;
  }

  /** Whether an event at exactly `time` jumps (a set or a release). */
  jumpsAt(time: number): boolean {
    return this.events.some((e) => e.time === time && e.how === 'set');
  }

  schedule(value: number, time: number, how: AutomationHow): void {
    this.insert({ time, value, how, rest: false });
  }

  cancelFrom(time: number): void {
    this.events = this.events.filter((e) => e.time < time);
  }

  hold(value: number, time: number): void {
    this.cancelFrom(time);
    this.insert({ time, value, how: 'set', rest: false });
  }

  release(time: number): void {
    this.cancelFrom(time);
    this.insert({ time, value: 0, how: 'set', rest: true });
  }

  /** Drop every event before the last one at or before `now`. */
  prune(now: number): void {
    pruneBefore(this.events, (e) => e.time, now);
  }

  /** The value at `time`, after every event at `time`. */
  at(time: number): number {
    return this.segment(
      this.lastIndex((t) => t <= time),
      time,
    );
  }

  /** The value just before `time`: what a ramp into `time` reaches. */
  approaching(time: number): number {
    return this.segment(
      this.lastIndex((t) => t < time),
      time,
    );
  }

  private lastIndex(within: (time: number) => boolean): number {
    let index = -1;
    this.events.forEach((e, i) => {
      if (within(e.time)) index = i;
    });
    return index;
  }

  /** The value at `time` on the segment from event `i` (or the start, at -1) to the next. */
  private segment(i: number, time: number): number {
    const next = this.events[i + 1];
    const ramps = next?.how === 'ramp';
    if (i < 0) return ramps ? this.valueOf(next) : this.resting();
    const prev = this.events[i]!;
    const from = this.valueOf(prev);
    const span = ramps ? next.time - prev.time : 0;
    if (!ramps || !(span > 0)) return from;
    return from + ((this.valueOf(next) - from) * (time - prev.time)) / span;
  }

  private valueOf(event: FieldEvent): number {
    return event.rest ? this.resting() : event.value;
  }

  private insert(event: FieldEvent): void {
    let at = this.events.length;
    while (at > 0 && this.events[at - 1]!.time > event.time) at--;
    this.events.splice(at, 0, event);
  }
}

/** Drop every item of `items`, in time order, before the last one at or before `now`. */
export function pruneBefore<T>(items: T[], timeOf: (item: T) => number, now: number): void {
  let anchor = -1;
  items.forEach((item, i) => {
    if (timeOf(item) <= now) anchor = i;
  });
  if (anchor > 0) items.splice(0, anchor);
}
