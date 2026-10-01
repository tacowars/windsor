/**
 * The Euclid card's density readouts (windsor#356, decision 2 of the issue):
 * the tab row's one-line note on the modulator, and the Density page's plot
 * of `k`. An LFO's plot is the `k` each of the next bars gets, read the way
 * the sequencer reads it on a bar line (`lfoValue` between the bounds,
 * rounded); a walk is random, so its plot is the bounds band and the
 * current `k`. Pure: the card draws the path this returns.
 */
import type { DensityMod, EuclideanSpec } from '@windsor/engine';
import { lfoValue } from '@windsor/engine';
import { EUCLID_PLOT } from './euclidConstants';

/** The modulator in a few words: `tri · 8 bars`, `sine · 0.25 Hz`, `walk · 0.5`. */
export function densityKindText(density: DensityMod): string {
  if (density.kind === 'lfoBars') return `${density.shape} · ${density.bars} bars`;
  if (density.kind === 'lfoHz') return `${density.shape} · ${density.hz} Hz`;
  return `walk · ${density.stepChance}`;
}

/** The tab row's note: `k 7 · 4–9 · tri · 8 bars`, or `captured` for a frozen figure. */
export function densityNote(spec: EuclideanSpec, k: number): string {
  if (spec.pattern) return 'captured';
  const { min, max } = spec.pulses;
  return `k ${k} · ${min}–${max} · ${densityKindText(spec.density)}`;
}

/** Where the plot reads from: the bar it starts on and the seconds a bar lasts (for an Hz LFO). */
export interface PlotClock {
  readonly bar: number;
  readonly secondsPerBar: number;
}

/** The `k` an LFO gives each of `count` bars from `clock.bar`; empty for a walk. */
export function lfoKs(spec: EuclideanSpec, clock: PlotClock, count: number): number[] {
  const { density } = spec;
  if (density.kind === 'walk') return [];
  const { min, max } = spec.pulses;
  return Array.from({ length: count }, (_, i) => {
    const bar = clock.bar + i;
    const phase =
      density.kind === 'lfoBars' ? bar / density.bars : bar * clock.secondsPerBar * density.hz;
    return min + Math.round(lfoValue(density.shape, phase) * (max - min));
  });
}

/** The plot's vertical scale: `k` from `lo` (bottom) to `hi` (top) inside the box. */
export interface PlotScale {
  readonly lo: number;
  readonly hi: number;
}

/** The scale for a figure's bounds: a little past each, within 0 and the figure's steps. */
export function plotScale(spec: EuclideanSpec, margin = EUCLID_PLOT.margin): PlotScale {
  const lo = Math.max(0, spec.pulses.min - margin);
  const hi = Math.min(spec.steps, spec.pulses.max + margin);
  return { lo, hi: Math.max(hi, lo + 1) };
}

/** The y of `k` in the plot box. */
export function plotY(k: number, scale: PlotScale, box = EUCLID_PLOT): number {
  const span = box.height - 2 * box.pad;
  return box.height - box.pad - ((k - scale.lo) / (scale.hi - scale.lo)) * span;
}

/** A step path across the box, one flat run per bar: the LFO's `k` over the bars ahead. */
export function plotPath(ks: readonly number[], scale: PlotScale, box = EUCLID_PLOT): string {
  const w = box.width / Math.max(1, ks.length);
  return ks
    .map((k, i) => {
      const y = plotY(k, scale, box).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${(i * w).toFixed(1)} ${y}H${((i + 1) * w).toFixed(1)}`;
    })
    .join('');
}
