/**
 * The Harmony tab's event-list edits (#705), pure: what a row's controls do
 * to the song's `harmony.events`. The list stays what the normaliser makes
 * of it — sorted, contiguous from tick 0, inside the song — so every
 * function relays the starts from the durations and returns a new list for
 * `ctx.change`, where arrays replace wholesale. A stopgap until the Song
 * view (#709) draws the timeline; the rules are the engine's
 * (`timelineNormalise.ts`), read here, not copied: a bad list is repaired
 * on the way into the document anyway.
 */
import type { ChordSize, HarmonyEvent } from '../../../packages/client/src/audio/index-for-editor';
import { PPQ, TICKS_PER_BAR } from '../../../packages/client/src/audio/index-for-editor';

/** A duration as the row shows it: whole bars and the beats left over. */
export function barsBeats(ticks: number): { bars: number; beats: number } {
  const bars = Math.floor(ticks / TICKS_PER_BAR);
  return { bars, beats: Math.floor((ticks - bars * TICKS_PER_BAR) / PPQ) };
}

export const toTicks = (bars: number, beats: number): number =>
  Math.max(0, Math.trunc(bars)) * TICKS_PER_BAR + Math.max(0, Math.trunc(beats)) * PPQ;

/** Starts relaid from tick 0 out of the durations; the last event's duration runs to the song end. */
export function relay(events: readonly HarmonyEvent[], songTicks: number): HarmonyEvent[] {
  const out: HarmonyEvent[] = [];
  let start = 0;
  events.forEach((event, index) => {
    if (start >= songTicks) return;
    const last = index === events.length - 1;
    const duration = Math.min(last ? songTicks - start : event.duration, songTicks - start);
    if (duration <= 0) return;
    out.push({ ...event, start, duration });
    start += duration;
  });
  const tail = out[out.length - 1];
  if (tail && tail.start + tail.duration < songTicks) {
    out[out.length - 1] = { ...tail, duration: songTicks - tail.start };
  }
  return out;
}

export function setDegree(
  events: readonly HarmonyEvent[],
  index: number,
  degree: number,
): HarmonyEvent[] {
  return events.map((e, i) => (i === index ? { ...e, degree } : e));
}

export function setSize(
  events: readonly HarmonyEvent[],
  index: number,
  size: ChordSize,
): HarmonyEvent[] {
  return events.map((e, i) => (i === index ? { ...e, size } : e));
}

/** One event's duration set (at least a beat), the rest relaid after it. */
export function setDuration(
  events: readonly HarmonyEvent[],
  index: number,
  ticks: number,
  songTicks: number,
): HarmonyEvent[] {
  const duration = Math.max(PPQ, ticks);
  return relay(
    events.map((e, i) => (i === index ? { ...e, duration } : e)),
    songTicks,
  );
}

/** The event removed; its span goes to the one before it (the one after, for the first); the only event stays. */
export function removeEvent(
  events: readonly HarmonyEvent[],
  index: number,
  songTicks: number,
): HarmonyEvent[] {
  if (events.length <= 1 || index < 0 || index >= events.length) return [...events];
  return relay(
    events.filter((_, i) => i !== index),
    songTicks,
  );
}

/**
 * A new event appended: a bar taken from the end of the last event when it
 * has more than one, else half of it, rounded down to a beat; nothing when a
 * beat cannot be spared. The new event copies the last one's chord.
 */
export function appendEvent(events: readonly HarmonyEvent[], songTicks: number): HarmonyEvent[] {
  const last = events[events.length - 1];
  if (!last) return relay([{ start: 0, duration: songTicks, degree: 0, size: 3 }], songTicks);
  const taken =
    last.duration > TICKS_PER_BAR ? TICKS_PER_BAR : Math.floor(last.duration / 2 / PPQ) * PPQ;
  if (taken < PPQ) return [...events];
  return relay(
    [
      ...events.slice(0, -1),
      { ...last, duration: last.duration - taken },
      { ...last, duration: taken },
    ],
    songTicks,
  );
}
