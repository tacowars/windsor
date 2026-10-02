/**
 * Where the song's meter puts its beats and bar lines in what the app draws
 * (windsor#431, record `2026-10-02-one-meter-per-song` "UI"): each beat's
 * start inside a bar, the beat a tick falls in, and the gap a step strip
 * draws before a step. The beats are the engine's (`meterBeats`), never
 * restated here; an absent meter is 4/4, as the song plays.
 *
 * The step grouping is the approved mockup's rule
 * (`docs/research/2026-10-02-time-signatures/mockup.html`, `lineInto` and
 * `groupOf`), shared by the Grid, Chord and Euclid strips.
 */
import type { Meter } from '@windsor/engine';
import { meterBeats } from '@windsor/engine';

/** The gap drawn before a step: a bar line's, a beat's, or none. */
export type StepGroup = 'bar' | 'beat' | '';

/** Steps per group when a step is a bar or longer: the strip's old grouping by four. */
const LONG_STEP_GROUP = 4;

/** Each counted beat's start in ticks from the bar line, the first 0. */
export function beatStarts(beats: readonly number[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const beat of beats) {
    starts.push(at);
    at += beat;
  }
  return starts;
}

/** The counted beat (0-based) `tickInBar` falls in, and that beat's start. */
export function beatAt(
  tickInBar: number,
  beats: readonly number[],
): { beat: number; start: number } {
  const starts = beatStarts(beats);
  let beat = 0;
  while (beat + 1 < starts.length && (starts[beat + 1] ?? Infinity) <= tickInBar) beat++;
  return { beat, start: starts[beat] ?? 0 };
}

const sum = (beats: readonly number[]): number => beats.reduce((a, b) => a + b, 0);

/**
 * The line that falls inside step `index`'s span — after the previous step's
 * start, up to and including its own — as a counted beat (0 is the bar line),
 * or -1 for none. A line no step lands on exactly belongs to the first step
 * past it, and a bar line wins when one step spans both.
 */
function lineInto(index: number, divisor: number, beats: readonly number[]): number {
  if (index === 0) return 0;
  const bar = sum(beats);
  const lo = (index - 1) * divisor;
  const hi = index * divisor;
  if (Math.floor(hi / bar) > Math.floor(lo / bar)) return 0;
  const barStart = Math.floor(lo / bar) * bar;
  const starts = beatStarts(beats);
  for (let k = 1; k < starts.length; k++) {
    const at = barStart + (starts[k] ?? 0);
    if (at > lo && at <= hi) return k;
  }
  return -1;
}

/**
 * The gap before step `index` of a strip of `divisor`-tick steps (windsor#431
 * decision 5): a beat gap before each step that starts a counted beat when
 * every beat holds two steps or more; otherwise a bar gap before each step
 * that starts a bar. When a step is a bar or longer, groups of four with the
 * beat gap, never the bar gap.
 */
export function stepGroup(index: number, divisor: number, beats: readonly number[]): StepGroup {
  if (index <= 0 || !(divisor > 0)) return '';
  if (divisor >= sum(beats)) return index % LONG_STEP_GROUP === 0 ? 'beat' : '';
  const line = lineInto(index, divisor, beats);
  if (line === 0) return 'bar';
  return line > 0 && Math.min(...beats) / divisor >= 2 ? 'beat' : '';
}

/** The gap before each step of a strip of `divisor`-tick steps in `meter`, by index. */
export function stepGrouper(divisor: number, meter?: Meter): (index: number) => StepGroup {
  const beats = meterBeats(meter);
  return (index) => stepGroup(index, divisor, beats);
}

/** Mark each column with its group's class (`.beat`, `.bar`), the gap `console.css` draws. */
export function groupColumns<T extends HTMLElement>(
  columns: readonly T[],
  divisor: number,
  meter?: Meter,
): readonly T[] {
  const groupAt = stepGrouper(divisor, meter);
  columns.forEach((col, i) => {
    const group = groupAt(i);
    col.classList.toggle('beat', group === 'beat');
    col.classList.toggle('bar', group === 'bar');
  });
  return columns;
}
