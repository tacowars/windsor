/**
 * The harmony lane's edits and labels (#709 decision 4; epic #703 decisions
 * 6, 10), pure: what the harmony card and the lane do to the song's
 * `harmony.events`. Events are contiguous from tick 0 — the shape the
 * normaliser keeps (`timelineNormalise.ts`) — so resizing one shifts every
 * following event and the last absorbs the difference at the song end,
 * deleting one merges its span into the previous (the first's into the
 * next), and appending takes a bar from the last. Every function relays the
 * starts from the durations and returns a new list for `ctx.change`, where
 * arrays replace wholesale. The names a block shows come from the engine's
 * `chordOf` / `chordName` / `romanNumeral`, never a second spelling.
 * `harmonyLaneModel.test.ts` pins the fixtures the ticket names.
 */
import type {
  ChordSize,
  Harmony,
  HarmonyEvent,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  CHORD_SIZE_SEVENTH,
  PPQ,
  TICKS_PER_BAR,
  chordName,
  chordOf,
  diatonicChords,
  pitchClassName,
  romanNumeral,
  scaleOffsets,
} from '../../../packages/client/src/audio/index-for-editor';

/** A duration as the card reads it: whole bars and the beats left over. */
export function barsBeats(ticks: number): { bars: number; beats: number } {
  const bars = Math.floor(ticks / TICKS_PER_BAR);
  return { bars, beats: Math.floor((ticks - bars * TICKS_PER_BAR) / PPQ) };
}

export const toTicks = (bars: number, beats: number): number =>
  Math.max(0, Math.trunc(bars)) * TICKS_PER_BAR + Math.max(0, Math.trunc(beats)) * PPQ;

/** `2 bars · 1 beat`, `1 bar`, `3 beats` — the Duration dial's readout. */
export function durationLabel(ticks: number): string {
  const { bars, beats } = barsBeats(ticks);
  const parts: string[] = [];
  if (bars > 0) parts.push(`${bars} bar${bars === 1 ? '' : 's'}`);
  if (beats > 0 || bars === 0) parts.push(`${beats} beat${beats === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** The one-based bar an event starts on: the pane's "Harmony — bar 3". */
export const eventBar = (event: HarmonyEvent): number =>
  Math.floor(event.start / TICKS_PER_BAR) + 1;

/** Starts relaid from tick 0 out of the durations; the last event runs to the song end; events past it are dropped. */
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

/**
 * The most an event can last: the song end less its start, less what the
 * events after it keep — each its own duration, the last at least a beat.
 * The last event's own duration is the song end's, never dialled.
 */
export function maxEventDuration(
  events: readonly HarmonyEvent[],
  index: number,
  songTicks: number,
): number {
  const event = events[index];
  if (!event) return 0;
  if (index === events.length - 1) return songTicks - event.start;
  const kept = events.slice(index + 1, -1).reduce((sum, e) => sum + Math.max(PPQ, e.duration), 0);
  return Math.max(PPQ, songTicks - event.start - kept - PPQ);
}

/** One event's duration set — at least a beat, at most what the song leaves — and every following event shifted after it. */
export function setEventDuration(
  events: readonly HarmonyEvent[],
  index: number,
  ticks: number,
  songTicks: number,
): HarmonyEvent[] {
  const event = events[index];
  if (!event) return [...events];
  if (index === events.length - 1) return relay(events, songTicks);
  const duration = Math.min(maxEventDuration(events, index, songTicks), Math.max(PPQ, ticks));
  return relay(
    events.map((e, i) => (i === index ? { ...e, duration } : e)),
    songTicks,
  );
}

/** The event removed; its span goes to the one before it (the one after, for the first), so nothing later moves; the only event stays. */
export function removeEvent(
  events: readonly HarmonyEvent[],
  index: number,
  songTicks: number,
): HarmonyEvent[] {
  const removed = events[index];
  if (events.length <= 1 || !removed) return [...events];
  const rest = events.filter((_, i) => i !== index);
  const absorb = Math.max(0, index - 1);
  const neighbour = rest[absorb] as HarmonyEvent;
  rest[absorb] = { ...neighbour, duration: neighbour.duration + removed.duration };
  return relay(rest, songTicks);
}

/**
 * The `+` tile: a new event of the last one's chord, a bar long, taken from
 * the end of the last event when it has more than a bar — else half of it,
 * rounded down to a beat; nothing when a beat cannot be spared.
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

/** The timeline after a song-length change: the last event extends or the tail is clamped; `changed` says whether anything moved. */
export function fitEvents(
  events: readonly HarmonyEvent[],
  songTicks: number,
): { events: HarmonyEvent[]; changed: boolean } {
  const fitted = relay(events, songTicks);
  const changed =
    fitted.length !== events.length ||
    fitted.some((e, i) => e.start !== events[i]?.start || e.duration !== events[i]?.duration);
  return { events: fitted, changed };
}

export interface EventLabel {
  /** `C min`, `G 7` — the engine's `chordName`. */
  readonly name: string;
  /** `i`, `VII7` — the engine's `romanNumeral`. */
  readonly numeral: string;
  readonly sizeTag: 'triad' | '7th';
}

/** What a block shows for an event, in the song's key. */
export function eventLabel(harmony: Harmony, event: HarmonyEvent): EventLabel {
  const offsets = scaleOffsets(harmony.scale);
  const chord = chordOf(offsets, event.degree, event.size);
  return {
    name: chordName(harmony.root, chord),
    numeral: romanNumeral(event.degree, chord.quality, offsets.length),
    sizeTag: event.size === CHORD_SIZE_SEVENTH ? '7th' : 'triad',
  };
}

export interface DegreeChip {
  readonly degree: number;
  readonly numeral: string;
  readonly pitch: string;
}

/** The card's degree chips: one per scale degree, numeral and pitch name in the key, at `size`. */
export function degreeChips(harmony: Harmony, size: ChordSize): DegreeChip[] {
  const offsets = scaleOffsets(harmony.scale);
  return diatonicChords(offsets, size).map((chord, degree) => ({
    degree,
    numeral: romanNumeral(degree, chord.quality, offsets.length),
    pitch: pitchClassName(harmony.root, offsets[degree] ?? 0),
  }));
}
