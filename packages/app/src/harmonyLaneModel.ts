/**
 * The harmony lane's edits and labels (#709 decision 4; epic #703 decisions
 * 6, 10), pure: what the harmony card and the lane do to the song's
 * `harmony.events`. Events are contiguous from tick 0 — the shape the
 * normaliser keeps (`timelineNormalise.ts`) — so the card's Duration dial
 * shifts every following event and the last absorbs the difference at the
 * song end, and deleting one merges its span into the previous (the first's
 * into the next). The lane's own edits — `+`, the seam drag and Alt-click —
 * are `harmonyLaneEdits.ts` (windsor#550). Every function here relays the
 * starts from the durations and returns a new list for `ctx.change`, where
 * arrays replace wholesale. The names a block shows come from the engine's
 * `eventChord` / `chordName` / `romanNumeral`, never a second spelling.
 * `harmonyLaneModel.test.ts` pins the fixtures the ticket names.
 *
 * Bars and beats are the song's meter (windsor#430 decision 3): a bar is
 * the sum of `meterBeats(meter)` and a beat is one of its counted beats, so
 * 6/8 counts dotted quarters and 7/8 counts 2 + 2 + 3. Each function takes
 * the meter's beats and defaults to 4/4's.
 */
import type { ChordSize, Harmony, HarmonyEvent, NamedQuality } from '@windsor/engine';
import {
  CHORD_SIZE_SEVENTH,
  CHORD_SIZE_TRIAD,
  PPQ,
  QUALITY_INTERVALS,
  chordName,
  diatonicChords,
  eventChord,
  foldDegree,
  meterBeats,
  pitchClassName,
  romanNumeral,
  scaleOffsets,
} from '@windsor/engine';

/** A meter's counted beats in ticks, in bar order (`meterBeats`). */
export type Beats = readonly number[];

const barOf = (beats: Beats): number => beats.reduce((sum, beat) => sum + beat, 0);

/** Which beat point a snap takes: the one at or below, the one at or above, or the nearest (a tie goes up). */
export type BeatSnap = 'floor' | 'ceil' | 'round';

/**
 * `ticks` on the beat grid: whole bars plus the beats counted from a bar's
 * start — every 24 ticks in 4/4, every 36 in 6/8, and 24, 48 and 84 in 7/8.
 */
export function snapToBeats(
  ticks: number,
  beats: Beats = meterBeats(),
  mode: BeatSnap = 'round',
): number {
  const bar = barOf(beats);
  if (!(bar > 0)) return ticks;
  const whole = Math.floor(ticks / bar) * bar;
  const rest = ticks - whole;
  let lo = 0;
  for (const beat of beats) {
    const hi = lo + beat;
    if (rest < hi) {
      if (mode === 'floor' || rest === lo) return whole + lo;
      if (mode === 'ceil') return whole + hi;
      return whole + (rest - lo < hi - rest ? lo : hi);
    }
    lo = hi;
  }
  return whole + bar;
}

/**
 * The Duration dial's value with Shift: `next` on the beat grid, moved off
 * `current` toward where the dial turned, so a 7/8 dial steps 24 · 48 · 84 ·
 * 108 and never rounds back to where it stood. In 4/4 and 6/8 the dial's
 * own step already lands on a beat.
 */
export function dialBeat(next: number, current: number, beats: Beats = meterBeats()): number {
  if (next === current) return current;
  return snapToBeats(next, beats, next > current ? 'ceil' : 'floor');
}

/** A duration as the card reads it: whole bars and the counted beats left over. */
export function barsBeats(
  ticks: number,
  beats: Beats = meterBeats(),
): { bars: number; beats: number } {
  const bar = barOf(beats);
  const bars = Math.floor(ticks / bar);
  let rest = ticks - bars * bar;
  let counted = 0;
  for (const beat of beats) {
    if (rest < beat) break;
    rest -= beat;
    counted++;
  }
  return { bars, beats: counted };
}

/** `bars` bars and `count` counted beats, in ticks. */
export function toTicks(bars: number, count: number, beats: Beats = meterBeats()): number {
  const bar = barOf(beats);
  const n = Math.max(0, Math.trunc(count));
  const into = beats.slice(0, n % beats.length).reduce((sum, beat) => sum + beat, 0);
  return (Math.max(0, Math.trunc(bars)) + Math.floor(n / beats.length)) * bar + into;
}

/** `2 bars · 1 beat`, `1 bar`, `3 beats` — the Duration dial's readout. */
export function durationLabel(ticks: number, beats: Beats = meterBeats()): string {
  const { bars, beats: counted } = barsBeats(ticks, beats);
  const parts: string[] = [];
  if (bars > 0) parts.push(`${bars} bar${bars === 1 ? '' : 's'}`);
  if (counted > 0 || bars === 0) parts.push(`${counted} beat${counted === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** The one-based bar an event starts on: the pane's "Harmony — bar 3". */
export const eventBar = (event: HarmonyEvent, beats: Beats = meterBeats()): number =>
  Math.floor(event.start / barOf(beats)) + 1;

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

/** An event copy an edit may write or `delete` a field on: a default is a removed key, so an export carries none. */
type MutableEvent = { -readonly [K in keyof HarmonyEvent]: HarmonyEvent[K] };

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
  return events.map((e, i) => {
    if (i !== index) return e;
    // A seventh (or triad) asked for by Size is the scale's own, so a named quality goes.
    const next: MutableEvent = { ...e, size };
    delete next.quality;
    return next;
  });
}

/**
 * A named quality, or the scale's own chord (`null`, the key removed)
 * (windsor#332 decision 1). A quality also sets the size it spells — two
 * intervals a triad, three a seventh — so the Size segment and the event
 * agree before the normaliser runs.
 */
export function setQuality(
  events: readonly HarmonyEvent[],
  index: number,
  quality: NamedQuality | null,
): HarmonyEvent[] {
  return events.map((e, i) => {
    if (i !== index) return e;
    const next: MutableEvent = { ...e };
    if (quality === null) {
      delete next.quality;
      return next;
    }
    next.quality = quality;
    // The root plus each interval: two make a triad, three a seventh.
    const tones = QUALITY_INTERVALS[quality].length + 1;
    next.size = tones === CHORD_SIZE_SEVENTH ? CHORD_SIZE_SEVENTH : CHORD_SIZE_TRIAD;
    return next;
  });
}

/** Flat (-1), natural (0, the key removed) or sharp (1) (windsor#332 decision 1). */
export function setAccidental(
  events: readonly HarmonyEvent[],
  index: number,
  accidental: -1 | 0 | 1,
): HarmonyEvent[] {
  return events.map((e, i) => {
    if (i !== index) return e;
    const next: MutableEvent = { ...e };
    if (accidental === 0) delete next.accidental;
    else next.accidental = accidental;
    return next;
  });
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
  const chord = eventChord(offsets, event);
  return {
    name: chordName(harmony.root, chord),
    numeral: romanNumeral(event.degree, chord.quality, offsets.length, event.accidental),
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

/**
 * The chip an event presses: its degree folded into the scale, as a ▶ reads
 * it, so a degree past the top (an octave carry) still lights its chip.
 */
export function chipDegree(harmony: Harmony, event: HarmonyEvent): number {
  return foldDegree(event.degree, scaleOffsets(harmony.scale).length).degree;
}
