/**
 * A fake param's value over time (windsor#344), replayed from its automation
 * log as Web Audio's timeline would hold it: `setValueAtTime` and
 * `linearRampToValueAtTime` events kept in time order (equal times in call
 * order), each cancel dropping the events at or after its time, and a ramp
 * running linearly from the event before it. `setTargetAtTime` is not
 * modelled. The fake itself still applies each call at once
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
export function timeline(log: readonly LoggedCall[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const { call, value, time = 0 } of log) {
    if (call === 'cancelScheduledValues' || call === 'cancelAndHoldAtTime') {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i]!.time >= time) events.splice(i, 1);
      }
      continue;
    }
    if (call !== 'setValueAtTime' && call !== 'linearRampToValueAtTime') continue;
    let at = events.length;
    while (at > 0 && events[at - 1]!.time > time) at--;
    events.splice(at, 0, { call, value, time });
  }
  return events;
}

/** The value at `time`; `initial` before the first event. */
export function timelineValueAt(log: readonly LoggedCall[], initial: number, time: number): number {
  let prev = { time: 0, value: initial };
  for (const event of timeline(log)) {
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
