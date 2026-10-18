/**
 * The Roll's words (windsor#602 decision 1), without the DOM: the tab bar's
 * summary — `bars 1–4 of 8 · 4-bar loop in an 8-bar region · 41 notes ·
 * A minor · snap 1/16`, led by the bars the notes pane shows (windsor#903
 * decision 7) — the ruler's repeat count, and the Loop readout.
 */
import { keyName } from './rollHarmony';
import { loopNoteCount } from './rollRepeats';
import type { RollSource } from './rollSource';
import { ROLL_BAR_FRACTIONS, ROLL_ZOOM_READOUT, ROLL_ZOOM_TEXT } from './rollTables';

/** Bars, to a tenth: 4, 1.5. */
export const barsOf = (ticks: number, barTicks: number, per = ROLL_BAR_FRACTIONS): number =>
  Math.round((ticks / barTicks) * per) / per;

/** `a` or `an` before a number read aloud: an 8, an 11, an 18, an 80. */
export function articleFor(n: number): string {
  const text = String(n);
  return /^8/.test(text) || /^1[18](\.|$)/.test(text) ? 'an' : 'a';
}

/** The bars a view shows, counted from 1. */
export interface ShownBars {
  readonly first: number;
  readonly last: number;
}

/** A view along time: the tick at its left edge, the ticks across it, and those at its right not counted. */
export interface ShownView {
  readonly left: number;
  readonly ticks: number;
  readonly slack: number;
}

type ReadoutTable = typeof ROLL_ZOOM_READOUT;

/** The ticks at a view's right edge not counted as shown, at `pxPerTick`: `slackPx`, at most `slackShare` of a bar. */
export const slackTicks = (
  pxPerTick: number,
  barTicks: number,
  table: ReadoutTable = ROLL_ZOOM_READOUT,
): number => Math.min(table.slackPx / pxPerTick, barTicks * table.slackShare);

/**
 * The bars `view` shows in a region `regionTicks` long: the bar at its left
 * edge to the bar its counted span ends in, never past the region's last.
 */
export function shownBars(view: ShownView, barTicks: number, regionTicks: number): ShownBars {
  const lastBar = Math.max(1, Math.ceil(regionTicks / barTicks));
  const first = Math.min(lastBar, Math.max(1, Math.floor(view.left / barTicks) + 1));
  const end = Math.ceil((view.left + view.ticks - view.slack) / barTicks);
  return { first, last: Math.min(lastBar, Math.max(first, end)) };
}

/** `bars 1–2`, `bar 3`. */
export const shownText = (shown: ShownBars): string =>
  ROLL_ZOOM_TEXT.shown(shown.first, shown.last);

/** What the summary says. */
export interface SummaryInput {
  readonly loopTicks: number;
  readonly regionTicks: number;
  readonly barTicks: number;
  /** The notes the loop plays. */
  readonly notes: number;
  readonly key: string;
  readonly snap: string;
  /** The bars the notes pane shows, which lead the summary once the pane has a width. */
  readonly shown?: ShownBars | null;
}

/** `bars 1–4 of 8 · 4-bar loop in an 8-bar region · 41 notes · A minor · snap 1/16`. */
export function rollSummary(input: SummaryInput): string {
  const loop = barsOf(Math.min(input.loopTicks, input.regionTicks), input.barTicks);
  const region = barsOf(input.regionTicks, input.barTicks);
  const notes = `${input.notes} note${input.notes === 1 ? '' : 's'}`;
  return [
    ...(input.shown ? [ROLL_ZOOM_TEXT.of(shownText(input.shown), region)] : []),
    `${loop}-bar loop in ${articleFor(region)} ${region}-bar region`,
    notes,
    input.key,
    `snap ${input.snap}`,
  ].join(' · ');
}

/** The device's summary of `source` at Snap `snap`, led by the bars `shown`. */
export const sourceSummary = (
  source: RollSource,
  snap: string,
  shown: ShownBars | null = null,
): string =>
  rollSummary({
    loopTicks: source.loopTicks,
    regionTicks: source.regionTicks,
    barTicks: source.barTicks,
    notes: loopNoteCount(source.notes, source.loopTicks, source.regionTicks),
    key: keyName(source.harmony),
    snap,
    shown,
  });

/** The ruler's count past the loop, `repeats ×2`; null when the loop fills the region. */
export function repeatsText(loopTicks: number, regionTicks: number): string | null {
  if (!(loopTicks > 0) || loopTicks >= regionTicks) return null;
  const times = regionTicks / loopTicks;
  return `repeats ×${Number.isInteger(times) ? times : times.toFixed(1)}`;
}

/** The Loop stepper's readout: `4 bars`, `1 bar`. */
export function loopText(loopTicks: number, barTicks: number): string {
  const bars = barsOf(loopTicks, barTicks);
  return `${bars} bar${bars === 1 ? '' : 's'}`;
}
