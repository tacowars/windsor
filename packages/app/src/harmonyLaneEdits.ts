/**
 * The harmony track's region edits (windsor#550, record
 * `2026-10-03-song-region-editing` decisions 1–3): `+` halves a chord, a
 * seam drag is a roll edit between two chords, and Alt-click splits a chord
 * at the snapped pointer. Pure, after the approved mockup's `plusInfo`,
 * `dragHarm` and `click`
 * (`docs/research/2026-10-03-song-region-editing/mockup.html`, layout
 * Proposed). Chords stay contiguous over the song and each lasts at least
 * a beat (PPQ); every function returns a new list for `ctx.change`, where
 * arrays replace wholesale. A new half copies its chord — degree, size,
 * quality and accidental.
 */
import type { HarmonyEvent } from '@windsor/engine';
import { PPQ, TICKS_PER_BAR } from '@windsor/engine';

/** An edit that adds a chord, and the index of the new one, which the lane selects. */
export interface ChordSplit {
  readonly events: HarmonyEvent[];
  readonly index: number;
}

const endOf = (event: HarmonyEvent): number => event.start + event.duration;

/**
 * Where `+` cuts `event`: its middle, rounded down to the song's bar lines;
 * to a beat line (PPQ from the song start) when no bar line leaves a beat
 * on each side; null when neither does, as for a chord under two beats.
 * A chord starting on a beat still cuts on a bar line.
 */
export function halvingPoint(event: HarmonyEvent, bar: number = TICKS_PER_BAR): number | null {
  const middle = event.start + event.duration / 2;
  for (const grid of [bar, PPQ]) {
    const at = Math.floor(middle / grid) * grid;
    if (at - event.start >= PPQ && endOf(event) - at >= PPQ) return at;
  }
  return null;
}

/** Which chord `+` halves: the selected one, or the rightmost when none is. */
export const halvingTarget = (events: readonly HarmonyEvent[], selected: number | null): number =>
  selected !== null && selected >= 0 && selected < events.length ? selected : events.length - 1;

/**
 * The last chord's wrapped hold over `[0, first.start)` — drawn when the
 * first chord starts late — cut at `tick`: a copy of the last chord is
 * inserted over `[tick, first.start)` as the new first event, and `[0, tick)`
 * stays the hold. Null unless both sides keep a beat.
 */
function splitWrappedHold(events: readonly HarmonyEvent[], tick: number): ChordSplit | null {
  const first = events[0];
  const last = events[events.length - 1];
  if (!first || !last || tick < PPQ || first.start - tick < PPQ) return null;
  return { events: [{ ...last, start: tick, duration: first.start - tick }, ...events], index: 0 };
}

/**
 * Chord `index` cut at `tick`, the right half a copy of it; null unless both
 * halves keep a beat. A tick before the first chord on the last chord is
 * its wrapped hold, split as that span (`splitWrappedHold`).
 */
export function splitEventAt(
  events: readonly HarmonyEvent[],
  index: number,
  tick: number,
): ChordSplit | null {
  const event = events[index];
  const firstStart = events[0]?.start ?? 0;
  if (event && index === events.length - 1 && tick < firstStart) {
    return splitWrappedHold(events, tick);
  }
  if (!event || tick - event.start < PPQ || endOf(event) - tick < PPQ) return null;
  const left = { ...event, duration: tick - event.start };
  const right = { ...event, start: tick, duration: endOf(event) - tick };
  return {
    events: [...events.slice(0, index), left, right, ...events.slice(index + 1)],
    index: index + 1,
  };
}

/** `+`: chord `index` halved at its `halvingPoint`; null when it is too short to halve. */
export function halveEvent(
  events: readonly HarmonyEvent[],
  index: number,
  bar: number = TICKS_PER_BAR,
): ChordSplit | null {
  const event = events[index];
  const at = event ? halvingPoint(event, bar) : null;
  return at === null ? null : splitEventAt(events, index, at);
}

/** `tick` on a grid of `grid` ticks from the song start, to the nearest line. */
export const snapToGrid = (tick: number, grid: number): number =>
  grid > 0 ? Math.round(tick / grid) * grid : tick;

/** The grid a seam or an Alt-click snaps to: the song's bar, or a beat (PPQ) with Shift. */
export const chordGrid = (fine: boolean, bar: number = TICKS_PER_BAR): number => (fine ? PPQ : bar);

/**
 * The seam after chord `index` rolled to `tick`: that chord ends there and
 * the next starts there, each kept at least a beat from its other end, and
 * every other chord stays put. The last chord's seam is the end of its
 * cyclic hold from tick 0 (`eventBounds` draws it when the first chord
 * starts later): rolling it moves the first chord's start, a beat from
 * tick 0 and from its end. Unchanged when there is no such seam.
 */
export function rollSeam(
  events: readonly HarmonyEvent[],
  index: number,
  tick: number,
): HarmonyEvent[] {
  const left = events[index];
  const wraps = index === events.length - 1 && (events[0]?.start ?? 0) > 0;
  const rightIndex = wraps ? 0 : index + 1;
  const right = events[rightIndex];
  if (!left || !right || right === left) return [...events];
  const end = endOf(right);
  const from = wraps ? 0 : left.start;
  const at = Math.min(end - PPQ, Math.max(from + PPQ, tick));
  return events.map((e, i) => {
    if (i === rightIndex) return { ...e, start: at, duration: end - at };
    if (i === index && !wraps) return { ...e, duration: at - e.start };
    return e;
  });
}
