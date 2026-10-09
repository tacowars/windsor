/**
 * The Roll's words (windsor#602 decision 1), without the DOM: the tab bar's
 * summary — `4-bar loop in an 8-bar region · 41 notes · A minor · snap
 * 1/16` — the ruler's repeat count, and the Loop readout.
 */
import { keyName } from './rollHarmony';
import { loopNoteCount } from './rollRepeats';
import type { RollSource } from './rollSource';
import { ROLL_BAR_FRACTIONS } from './rollTables';

/** Bars, to a tenth: 4, 1.5. */
export const barsOf = (ticks: number, barTicks: number, per = ROLL_BAR_FRACTIONS): number =>
  Math.round((ticks / barTicks) * per) / per;

/** `a` or `an` before a number read aloud: an 8, an 11, an 18, an 80. */
export function articleFor(n: number): string {
  const text = String(n);
  return /^8/.test(text) || /^1[18](\.|$)/.test(text) ? 'an' : 'a';
}

/** What the summary says. */
export interface SummaryInput {
  readonly loopTicks: number;
  readonly regionTicks: number;
  readonly barTicks: number;
  /** The notes the loop plays. */
  readonly notes: number;
  readonly key: string;
  readonly snap: string;
}

/** `4-bar loop in an 8-bar region · 41 notes · A minor · snap 1/16`. */
export function rollSummary(input: SummaryInput): string {
  const loop = barsOf(Math.min(input.loopTicks, input.regionTicks), input.barTicks);
  const region = barsOf(input.regionTicks, input.barTicks);
  const notes = `${input.notes} note${input.notes === 1 ? '' : 's'}`;
  return [
    `${loop}-bar loop in ${articleFor(region)} ${region}-bar region`,
    notes,
    input.key,
    `snap ${input.snap}`,
  ].join(' · ');
}

/** The device's summary of `source` at Snap `snap`. */
export const sourceSummary = (source: RollSource, snap: string): string =>
  rollSummary({
    loopTicks: source.loopTicks,
    regionTicks: source.regionTicks,
    barTicks: source.barTicks,
    notes: loopNoteCount(source.notes, source.loopTicks, source.regionTicks),
    key: keyName(source.harmony),
    snap,
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
