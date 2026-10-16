/**
 * A fake param's value over time (windsor#344), replayed from its automation
 * log as Web Audio's timeline would hold it: `setValueAtTime` and
 * `linearRampToValueAtTime` events kept in time order (equal times in call
 * order), `cancelScheduledValues` dropping the events at or after its time,
 * and a ramp running linearly from the event before it, however long ago that
 * was. `cancelAndHoldAtTime` drops the events after its time and holds the
 * value there only when one of them was still to come; after a finished ramp,
 * or on a param with no events, it adds nothing, so a ramp scheduled next
 * still starts from the last event, as Chrome renders it (windsor#694).
 * `setTargetAtTime` is not modelled. The fake itself still applies each call at once
 * (`fakeAudioNodes.ts`); this is what a test reads the schedule with.
 */

/** One logged call, as `FakeParam.automation` holds it. */
export interface LoggedCall {
  readonly call: string;
  readonly value: number;
  readonly time?: number;
}

interface TimelineEvent {
  readonly call: string;
  readonly value: number;
  readonly time: number;
}

/** The events the log leaves scheduled, in time order. */
export function timeline(log: readonly LoggedCall[], initial = 0): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const { call, value, time = 0 } of log) {
    if (call === 'cancelScheduledValues') {
      dropFrom(events, (t) => t >= time);
      continue;
    }
    if (call === 'cancelAndHoldAtTime') {
      if (!events.some((e) => e.time > time)) continue;
      const held = valueOf(events, initial, time);
      dropFrom(events, (t) => t > time);
      insert(events, { call: 'setValueAtTime', value: held, time });
      continue;
    }
    if (call !== 'setValueAtTime' && call !== 'linearRampToValueAtTime') continue;
    insert(events, { call, value, time });
  }
  return events;
}

function dropFrom(events: TimelineEvent[], drops: (time: number) => boolean): void {
  for (let i = events.length - 1; i >= 0; i--) if (drops(events[i]!.time)) events.splice(i, 1);
}

function insert(events: TimelineEvent[], event: TimelineEvent): void {
  let at = events.length;
  while (at > 0 && events[at - 1]!.time > event.time) at--;
  events.splice(at, 0, event);
}

/** The value at `time`; `initial` before the first event. */
export function timelineValueAt(log: readonly LoggedCall[], initial: number, time: number): number {
  return valueOf(timeline(log, initial), initial, time);
}

function valueOf(events: readonly TimelineEvent[], initial: number, time: number): number {
  let prev = { time: 0, value: initial };
  for (const event of events) {
    if (event.time <= time) {
      prev = event;
      continue;
    }
    if (event.call !== 'linearRampToValueAtTime') break;
    const span = event.time - prev.time;
    if (!(span > 0)) return prev.value;
    return prev.value + ((event.value - prev.value) * (time - prev.time)) / span;
  }
  return prev.value;
}
