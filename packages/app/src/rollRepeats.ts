/**
 * Where the Roll draws each note (windsor#602 decision 3), without the DOM:
 * a note inside the loop once per pass of the loop through the region — the
 * first pass the note itself, every later pass a ghost repeat — each cut at
 * the loop's end and at the region's end; a note at or past the loop's end
 * once, parked (drawn hollow and silent) where it lies, cut at the region's
 * end. A note or a repeat that starts at or past the region's end is not
 * drawn, as it never sounds.
 *
 * Only what overlaps a window of ticks is drawn: the notes pane's view and a
 * screen either side (`rollWindow`). A short loop in a long region repeats
 * far more often than the pane can show, so the cost is the window's, never
 * the region's. Repeats packed closer than a note's least width are one band
 * on screen anyway, and more than a paint's budget can't be drawn one by
 * one, so either way they are drawn as runs: one to each chord span, or, if
 * those are still too many, one to each note.
 */
import type { RollNote } from '@windsor/engine';
import { ROLL_DRAW_MARGIN_SCREENS } from './rollTables';

/** One drawn note: which note, where it starts in the region, how long it is drawn. */
export interface RollInstance {
  /** The note's index in the roll's list. */
  readonly index: number;
  /** The onset in the region's local ticks. */
  readonly start: number;
  readonly ticks: number;
  /** The loop's pass: 0 for the note itself, 1 and up for its ghost repeats. */
  readonly pass: number;
  /** A note past the loop: kept, drawn hollow, silent. */
  readonly parked: boolean;
}

/** A span of the region's local ticks, from `from` up to but not including `to`. */
export interface TickWindow {
  readonly from: number;
  readonly to: number;
}

/** The notes pane's horizontal view. */
export interface PaneView {
  readonly scrollPx: number;
  readonly widthPx: number;
  readonly pxPerTick: number;
  readonly regionTicks: number;
}

/** The ticks `view` shows, widened by `margin` screens either side, within the region. */
export function rollWindow(view: PaneView, margin = ROLL_DRAW_MARGIN_SCREENS): TickWindow {
  const from = (view.scrollPx - margin * view.widthPx) / view.pxPerTick;
  const to = (view.scrollPx + (1 + margin) * view.widthPx) / view.pxPerTick;
  return { from: Math.max(0, from), to: Math.min(view.regionTicks, to) };
}

/** Whether `outer` holds all of `inner`. */
export const windowHolds = (outer: TickWindow, inner: TickWindow): boolean =>
  inner.from >= outer.from && inner.to <= outer.to;

/** How a roll's notes repeat, and the ticks they are drawn for. */
export interface RepeatLayout {
  readonly loopTicks: number;
  readonly regionTicks: number;
  readonly within: TickWindow;
  /** A note's least drawn length, in ticks: repeats closer than this are drawn as runs. */
  readonly minTicks?: number;
  /** The region-local ticks a run breaks at, ascending: where the chord, and so the colour, changes. */
  readonly breaks?: readonly number[];
  /** The most notes and repeats one paint draws one by one; past it, repeats are drawn as runs. */
  readonly budget?: number;
}

/** What the window draws as it is: every repeat (null), or runs that break at these ticks. */
type RunBreaks = readonly number[] | null;

/**
 * Every repeat, while they can be told apart and fit the budget; else runs
 * that break at the chord changes inside the window, while those fit; else
 * one run to a note.
 */
function runBreaks(
  notes: readonly RollNote[],
  layout: RepeatLayout,
  within: TickWindow,
): RunBreaks {
  const { loopTicks, regionTicks } = layout;
  const budget = layout.budget ?? Infinity;
  const looped = notes.filter((note) => note.tick < Math.min(loopTicks, regionTicks)).length;
  const repeats = looped * ((within.to - within.from) / loopTicks + 1);
  if (loopTicks >= (layout.minTicks ?? 0) && notes.length + repeats <= budget) return null;
  const breaks = (layout.breaks ?? []).filter((at) => at > within.from && at < within.to);
  return notes.length + looped * (breaks.length + 1) <= budget ? breaks : [];
}

/** One looped note being laid out. */
interface Looped {
  readonly index: number;
  readonly tick: number;
  /** Its length within the loop. */
  readonly held: number;
}

/** The first break after `tick`, or none. */
const nextBreak = (breaks: readonly number[], tick: number): number =>
  breaks.find((at) => at > tick) ?? Infinity;

/** Where a looped note's runs go: the loop, the region, the window's end and the breaks. */
interface RunSpan {
  readonly loop: number;
  readonly region: number;
  readonly to: number;
  readonly breaks: readonly number[];
}

/**
 * A note's repeats as runs, each from one repeat's start to the last
 * repeat's end before the next break: the same band the overlapping repeats
 * would draw. The note itself is never part of a run.
 */
function pushRuns(out: RollInstance[], note: Looped, first: number, span: RunSpan): void {
  const { index, tick, held } = note;
  const { loop, region, to, breaks } = span;
  let pass = first;
  if (pass === 0) {
    if (tick >= to) return;
    out.push({ index, start: tick, ticks: Math.min(held, region - tick), pass, parked: false });
    pass = 1;
  }
  for (let start = tick + pass * loop; start < to; start = tick + pass * loop) {
    const runEnd = Math.min(to, nextBreak(breaks, start));
    const last = Math.ceil((runEnd - tick) / loop) - 1;
    const end = Math.min(tick + last * loop + held, region);
    out.push({ index, start, ticks: end - start, pass, parked: false });
    pass = last + 1;
  }
}

/**
 * The notes and repeats the region draws for `notes` that overlap
 * `layout.within`: per note, one for each loop's length the window spans
 * or, where those would overlap or pass the budget, runs (`runBreaks`);
 * never every repeat of the region.
 */
export function rollInstances(notes: readonly RollNote[], layout: RepeatLayout): RollInstance[] {
  const { loopTicks, regionTicks } = layout;
  const from = Math.max(0, layout.within.from);
  const to = Math.min(regionTicks, layout.within.to);
  const out: RollInstance[] = [];
  if (!(to > from)) return out;
  const breaks = runBreaks(notes, layout, { from, to });
  notes.forEach((note, index) => {
    if (note.tick >= regionTicks) return;
    if (note.tick >= loopTicks) {
      const ticks = Math.min(note.ticks, regionTicks - note.tick);
      if (note.tick < to && note.tick + ticks > from) {
        out.push({ index, start: note.tick, ticks, pass: 0, parked: true });
      }
      return;
    }
    const held = Math.min(note.ticks, loopTicks - note.tick);
    // The first pass still sounding at `from`: the least whose start + held passes it.
    const first = Math.max(0, Math.floor((from - note.tick - held) / loopTicks) + 1);
    if (breaks) {
      const span = { loop: loopTicks, region: regionTicks, to, breaks };
      pushRuns(out, { index, tick: note.tick, held }, first, span);
      return;
    }
    for (let pass = first; note.tick + pass * loopTicks < to; pass++) {
      const start = note.tick + pass * loopTicks;
      out.push({ index, start, ticks: Math.min(held, regionTicks - start), pass, parked: false });
    }
  });
  return out;
}

/** Whether `instance` is sounding at the region's local tick `tick`. */
export const sounding = (instance: RollInstance, tick: number): boolean =>
  !instance.parked && tick >= instance.start && tick < instance.start + instance.ticks;

/** The notes the loop plays: those that start inside both the loop and the region. */
export const loopNoteCount = (
  notes: readonly RollNote[],
  loopTicks: number,
  regionTicks: number,
): number => notes.filter((note) => note.tick < Math.min(loopTicks, regionTicks)).length;

/**
 * Where a note Rec still holds starts in the region (windsor#663): on the
 * pass of the loop it was pressed in, read from its region-local onset
 * `local` the way the playhead reads the song's tick (`rollPosition`), so
 * it grows under the playhead on every pass, not only the first.
 */
export function heldStart(
  note: { readonly tick: number; readonly local: number },
  layout: { readonly loopTicks: number; readonly regionTicks: number },
): number {
  const { loopTicks, regionTicks } = layout;
  if (!(loopTicks > 0 && regionTicks > 0)) return note.tick;
  const pass = Math.floor((note.local % regionTicks) / loopTicks);
  const start = pass * loopTicks + note.tick;
  return start < regionTicks ? start : note.tick;
}
