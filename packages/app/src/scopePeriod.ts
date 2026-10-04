/**
 * The Output display's Cycle view (windsor#586 decision 4): the period of the
 * master signal, and where a cycle of it starts. Pure and allocation-free per
 * call: a detector owns its buffers, sized once for its sample rate and the
 * analyser's buffer, and `detect` reads the newest samples it is handed.
 *
 * The period is YIN's (de Cheveigné and Kawahara, 2002): the difference
 * function over a bounded lag range, normalised by its cumulative mean, its
 * first dip below a threshold taken as the period. The search runs on a
 * decimated copy, each sample the mean of `decimation` inputs, which bounds
 * its cost; the lag it finds is then refined at the full rate, interpolated
 * between samples, and kept only if one period apart the signal matches
 * itself to `clarity`. Silence, noise and a chord with no short common
 * period find none. Pinned by `scopePeriod.test.ts`.
 */
import { SCOPE_PERIOD } from './scopeConstants';
import { vertexOffset, vertexValue } from './scopeParabola';

/** The detector's tunables: `SCOPE_PERIOD`'s shape. */
export interface PeriodTable {
  readonly minHz: number;
  readonly maxHz: number;
  readonly decimation: number;
  readonly threshold: number;
  readonly clarity: number;
  readonly silence: number;
  readonly fineMinHz: number;
}

export interface PeriodDetectorOptions {
  readonly sampleRate: number;
  /** How many samples each `detect` is handed (the analyser's `fftSize`). */
  readonly length: number;
  readonly table?: PeriodTable;
}

export interface PeriodDetector {
  /** How many samples `detect` expects. */
  readonly length: number;
  /** The period of the newest samples of `x`, in samples, or 0 when none is clear. */
  detect(x: Float32Array): number;
}

/** The squared difference of `x` against itself `lag` later over `w` samples from `base`, over their energy. */
function normalisedDifference(x: Float32Array, base: number, w: number, lag: number): number {
  let diff = 0;
  let energy = 0;
  for (let j = base; j < base + w; j++) {
    const a = x[j]!;
    const b = x[j + lag]!;
    diff += (a - b) * (a - b);
    energy += a * a + b * b;
  }
  return energy > 0 ? diff / energy : 1;
}

/** A YIN search over `out.length − 1` lags at most: the first dip at or past `minLag` under `threshold`. */
type YinSearch = (x: Float32Array, base: number, window: number, maxLag: number) => number;

function yinSearch(out: Float64Array, minLag: number, threshold: number): YinSearch {
  return (x, base, window, maxLag) => {
    let running = 0;
    for (let lag = 1; lag <= maxLag; lag++) {
      let d = 0;
      for (let j = base; j < base + window; j++) {
        const e = x[j]! - x[j + lag]!;
        d += e * e;
      }
      running += d;
      out[lag] = running > 0 ? (d * lag) / running : 1;
    }
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (out[lag]! >= threshold) continue;
      while (lag < maxLag && out[lag + 1]! < out[lag]!) lag++;
      return lag;
    }
    return 0;
  };
}

/** The shortest lag any search tries: lag 1's normalised difference is 1 by definition. */
const SHORTEST_LAG = 2;

interface LagRanges {
  readonly step: number;
  readonly minLag: number;
  readonly maxLag: number;
  readonly window: number;
  readonly fineMaxLag: number;
}

/** `table`'s lag ranges at `sampleRate` for a buffer of `length`, in samples. */
function lagRanges(sampleRate: number, length: number, table: PeriodTable): LagRanges {
  const step = Math.max(1, Math.round(table.decimation));
  const minLag = Math.max(SHORTEST_LAG, Math.floor(sampleRate / table.maxHz));
  // The integration window is as long as the longest lag, and both fit in the buffer.
  const longest = Math.min(Math.ceil(sampleRate / table.minHz), Math.floor(length / 2));
  const maxLag = Math.max(minLag + 1, longest);
  const window = Math.min(maxLag, length - maxLag);
  const fineMaxLag = Math.min(maxLag, Math.ceil(sampleRate / table.fineMinHz));
  return { step, minLag, maxLag, window, fineMaxLag };
}

/** The full-rate lag near a guess, interpolated, or 0 when it is not clear enough or out of range. */
type Refine = (x: Float32Array, base: number, guess: number) => number;

function createRefiner(sampleRate: number, ranges: LagRanges, table: PeriodTable): Refine {
  const { step, minLag, maxLag, window } = ranges;
  // The refinement's lags: the guess ± one step, and one more either side for the vertex.
  const fine = new Float64Array(2 * step + 2 + 1);
  // The range bounds the final, interpolated period, not only its integer lag.
  const shortestPeriod = sampleRate / table.maxHz;
  const longestPeriod = sampleRate / table.minHz;

  return (x, base, guess) => {
    const first = guess - step - 1;
    for (let i = 0; i < fine.length; i++) {
      const lag = first + i;
      fine[i] = lag >= 1 && lag <= maxLag ? normalisedDifference(x, base, window, lag) : Infinity;
    }
    let at = -1;
    for (let i = 1; i < fine.length - 1; i++) {
      const lag = first + i;
      if (lag < minLag || lag > maxLag) continue;
      if (at < 0 || fine[i]! < fine[at]!) at = i;
    }
    if (at < 0) return 0;
    const a = fine[at - 1]!;
    const b = fine[at]!;
    const c = fine[at + 1]!;
    // A dip on the last lag the buffer holds is not bracketed: its period may lie past it.
    if (!Number.isFinite(c)) return 0;
    const offset = vertexOffset(a, b, c);
    const value = vertexValue(a, b, c, offset);
    if (1 - value < table.clarity) return 0;
    const period = first + at + offset;
    return period >= shortestPeriod && period <= longestPeriod ? period : 0;
  };
}

export function createPeriodDetector(options: PeriodDetectorOptions): PeriodDetector {
  const { sampleRate, length, table = SCOPE_PERIOD } = options;
  const ranges = lagRanges(sampleRate, length, table);
  const { step, minLag, maxLag, window, fineMaxLag } = ranges;
  const coarseWindow = Math.floor(window / step);
  const coarseMaxLag = Math.floor(maxLag / step);
  const coarse = new Float32Array(coarseWindow + coarseMaxLag + 1);
  const coarseMinLag = Math.max(1, Math.floor(minLag / step));
  const coarseYin = yinSearch(new Float64Array(coarseMaxLag + 1), coarseMinLag, table.threshold);
  // The full-rate search starts below `minLag`, so a tone above `maxHz` is seen
  // as one and not taken at a multiple of its period that lies in range.
  const fineYin = yinSearch(new Float64Array(fineMaxLag + 1), SHORTEST_LAG, table.threshold);
  const refine = createRefiner(sampleRate, ranges, table);

  /** The decimated copy of the samples from `base`: each the mean of `step` inputs. */
  const decimate = (x: Float32Array, base: number): void => {
    for (let i = 0; i < coarse.length; i++) {
      let sum = 0;
      const from = base + i * step;
      for (let k = 0; k < step; k++) sum += x[Math.min(x.length - 1, from + k)]!;
      coarse[i] = sum / step;
    }
  };

  return {
    length,
    detect(x) {
      const base = x.length - window - maxLag;
      if (base < 0) return 0;
      let power = 0;
      for (let i = base; i < x.length; i++) power += x[i]! * x[i]!;
      if (power / (window + maxLag) < table.silence) return 0;
      decimate(x, base);
      const coarseLag = coarseYin(coarse, 0, coarseWindow, coarseMaxLag);
      if (coarseLag === 0) return 0;
      let guess = coarseLag * step;
      // A short period is searched again at the full rate, where the coarse lag grid
      // can miss a bright tone's true period and land on twice it.
      const lags = guess + step + 1;
      if (lags <= fineMaxLag) {
        const fineLag = fineYin(x, x.length - 2 * lags, lags, lags);
        if (fineLag > 0 && fineLag < minLag) return 0;
        guess = fineLag || guess;
      }
      return refine(x, base, guess);
    },
  };
}

/**
 * Where a cycle starts in `x` between `from` and `to`: the rising zero
 * crossing with the steepest rise, at its interpolated position, so the same
 * point of the wave is found frame after frame. `from` when there is none.
 */
export function risingCrossing(x: Float32Array, from: number, to: number): number {
  let at = from;
  let steepest = 0;
  const lo = Math.max(1, Math.floor(from) + 1);
  const hi = Math.min(x.length - 1, Math.ceil(to));
  for (let i = lo; i <= hi; i++) {
    const a = x[i - 1]!;
    const b = x[i]!;
    if (a <= 0 && b > 0 && b - a > steepest) {
      steepest = b - a;
      at = i - 1 + a / (a - b);
    }
  }
  return at;
}
