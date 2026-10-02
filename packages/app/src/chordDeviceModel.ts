/**
 * The Chord device's Steps label (windsor#369; the look is
 * `docs/research/2026-09-30-sequencer-rack/chord.html`): how many steps the
 * pattern writes and how many bars one pass of them lasts, durations and
 * repeats included. The pass is `songViewTables.ts`'s `CYCLE_TICKS`, the
 * same count the lane draws its cycle ticks from.
 */
import type { ChordSpec } from '@windsor/engine';
import { TICKS_PER_BAR } from '@windsor/engine';
import { CYCLE_TICKS } from './songViewTables';

/** One pass of the pattern in bars: whole, or to two places. */
export function chordBars(spec: ChordSpec, ticksPerBar = TICKS_PER_BAR): string {
  const bars = (CYCLE_TICKS.chord(spec) ?? 0) / ticksPerBar;
  return Number.isInteger(bars) ? String(bars) : bars.toFixed(2);
}

/** `8 · 1 bar`, `5 · 1.25 bars`. */
export function chordStepsLabel(spec: ChordSpec, ticksPerBar = TICKS_PER_BAR): string {
  const bars = chordBars(spec, ticksPerBar);
  return `${spec.steps.length} · ${bars} bar${bars === '1' ? '' : 's'}`;
}
