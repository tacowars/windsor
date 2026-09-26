/**
 * The harmony timeline (#705, epic #703 decisions 5, 6 and 10): which chord
 * the song is on at a transport tick.
 *
 * A song's `harmony.events` is a sorted, contiguous list of
 * `{ start, duration, degree, size }` inside the song's `songTicks`. An
 * event holds from its `start` to the next event's start; the last holds to
 * the song end; and the timeline is cyclic, so a first event starting after
 * tick 0 means the last event holds from tick 0 until it. Lookups are
 * `tick mod songTicks` — the transport's absolute tick never wraps. Rests
 * are gaps in the parts' regions, never in the harmony (decision 6).
 *
 * Pure: the document's harmony in, a chord out. Nothing here reaches the
 * audio graph, and the events arrive normalised (`arrangementNormalise.ts`).
 */
import { chordTones, type ChordSize } from './chordTheory';
import { scaleOffsets } from '../sequencing/scaleSampler';
import type { ScaleName } from '../sequencing/scaleSampler';

export interface HarmonyEvent {
  /** Absolute song tick the chord starts on. */
  readonly start: number;
  /** Ticks to the next event's start (the song end for the last). */
  readonly duration: number;
  /** Scale degree of the chord root; past the scale it wraps with octave carry. */
  readonly degree: number;
  readonly size: ChordSize;
}

/** The song's harmony: a key and the chord timeline over it. */
export interface Harmony {
  /** Pitch class 0–11 of the key root (decision 11). */
  readonly root: number;
  readonly scale: ScaleName | readonly number[];
  readonly events: readonly HarmonyEvent[];
}

/** The chord a performer plays at a tick: what `chordAt` hands the sequencers. */
export interface HarmonyChord {
  readonly event: HarmonyEvent;
  /** Index into `harmony.events`. */
  readonly index: number;
  /**
   * Semitones from the key root to the chord's root, octave carry included —
   * the first of `chordTones`, so a bass following the chord needs no second
   * fold.
   */
  readonly tonesRoot: number;
}

/** One drawn block of the timeline: `[start, end)` in song ticks and the event it shows. */
export interface EventBounds {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

/** The index of the event holding at `songTick`: the last one starting at or before it, cyclically. */
function indexAt(events: readonly HarmonyEvent[], songTick: number): number {
  let found = -1;
  for (let index = 0; index < events.length; index++) {
    if ((events[index] as HarmonyEvent).start > songTick) break;
    found = index;
  }
  // Before the first event, the last one holds (the timeline is cyclic).
  return found < 0 ? events.length - 1 : found;
}

/** The chord holding at transport `tick`, or null when the harmony has no events. */
export function chordAt(harmony: Harmony, songTicks: number, tick: number): HarmonyChord | null {
  const { events } = harmony;
  if (events.length === 0 || !(songTicks > 0)) return null;
  const songTick = ((tick % songTicks) + songTicks) % songTicks;
  const index = indexAt(events, songTick);
  const event = events[index] as HarmonyEvent;
  const tones = chordTones(scaleOffsets(harmony.scale), event.degree, event.size);
  return { event, index, tonesRoot: tones[0] ?? 0 };
}

/**
 * The blocks a console draws: each event from its start to the next start
 * (the song end for the last), and — when the first event starts after
 * tick 0 — the last event's hold from tick 0 as a leading block.
 */
export function eventBounds(harmony: Harmony, songTicks: number): EventBounds[] {
  const { events } = harmony;
  const out: EventBounds[] = [];
  if (events.length === 0) return out;
  const first = events[0] as HarmonyEvent;
  if (first.start > 0) out.push({ index: events.length - 1, start: 0, end: first.start });
  events.forEach((event, index) => {
    const next = events[index + 1];
    out.push({ index, start: event.start, end: next ? next.start : songTicks });
  });
  return out;
}
