/** Declared windsor#207 sweep, tones and reporting figures, fixed before measurement.
 * Reporting thresholds for choosing among these filters, not audibility claims,
 * product acceptance, product filters or defaults. The FIR family is the phase-3
 * `coefficients` (Blackman-windowed sinc, cutoff 0.45 / factor), imported unchanged.
 */
import { EXPERIMENT } from '../2026-09-30-tape-phase-3/experimentConstants';
export { EXPERIMENT };
export const RESAMPLER = {
  rate: EXPERIMENT.benchmarkRate,
  /** Length in host samples: taps = span × factor + 1, each FIR delays span / 2. */
  spans: [16, 24, 32, 48, 64],
  factors: [2, 4, 8],
  /** Interpolator magnitude grid: points from 0 to the oversampled Nyquist, both inclusive. */
  grid: 4096,
  gridDecimals: 4,
  /** Host tones (fractions of host fs) whose images and aliases are measured. */
  tones: [0.05, 0.1, 0.2, 0.3, 0.4, 0.45],
  /** Passband 0 … 0.40 host fs: the impulse-response scan and the tone sweep. */
  passbandEdge: 0.4,
  passbandPoints: 4001,
  passbandTones: 40,
  edgesDb: [-0.1, -1, -6],
  edgeBisections: 48,
  /** Declared reporting figures (the epic's -60 dBc, and ±0.1 dB to 0.40 fs). */
  levelTargetDb: -60,
  passbandTargetDb: 0.1,
  /** Coherent rectangular windows: every declared tone is an exact bin of 400. */
  toneFrames: 400,
  /** Bin grid for the tone-measured edges (bisection, then linear in dB). */
  edgeFrames: 8192,
  /** Host frames discarded before a window; more than 2 × the largest span + 1. */
  settleFrames: 256,
  /** Amplitude floor for dB (-300 dB). */
  amplitudeFloor: 1e-15,
  /** Impulse-response and direct-tone methods must agree within these. */
  agreement: { passbandDb: 0.01, levelDb: 1 },
  /** Coefficient checks. Measured residuals are reported beside the verdict. */
  symmetryTolerance: 1e-15,
  sumTolerance: 1e-14,
  delayTolerance: 1e-9,
  /** Part 2: deterministic stereo signal, bound relative to its peak. */
  equivalence: { frames: 65536, relativeBound: 1e-15, noise: 0.5, seed: 207 },
  /** Part 3: the phase-3 method (EXPERIMENT.benchmarkSeconds, rounds, input). */
  benchmark: {
    seconds: EXPERIMENT.benchmarkSeconds,
    rounds: EXPERIMENT.rounds,
    benchmarkSpan: 32,
    /** Phase-3's precomputed input: Σ amplitude · sin(i · radians); right = -left. */
    input: [
      [0.3, 0.057],
      [0.1, 0.37],
    ],
  },
  /** Wall-clock milliseconds for the whole numerical child. */
  budgetMs: 900000,
};
export type Resampler = typeof RESAMPLER;
export type Variant = 'a' | 'b' | 'c' | 'd';
/** a/b identity core, c/d RK4 core; a/c the existing decimator, b/d the symmetric one. */
export const VARIANTS: Record<Variant, { identity: boolean; symmetric: boolean }> = {
  a: { identity: true, symmetric: false },
  b: { identity: true, symmetric: true },
  c: { identity: false, symmetric: false },
  d: { identity: false, symmetric: true },
};
export interface Filter {
  factor: number;
  span: number;
}
export const filterId = (f: Filter): string => `${f.factor}x/${f.span}`;
/** The fifteen filters, factor then span ascending: the order parts 1 and 2 run. */
export function filters(table: Resampler = RESAMPLER): Filter[] {
  return table.factors.flatMap((factor) => table.spans.map((span) => ({ factor, span })));
}
export interface Cell extends Filter {
  id: string;
  variant: Variant;
}
const cell = (variant: Variant, factor: number, span: number): Cell => ({
  id: `${variant}/${factor}x/${span}`,
  variant,
  factor,
  span,
});
/** Part 3 groups, cheapest first: identity sweeps by factor, then a/b/c/d at span 32. */
export function benchmarkGroups(table: Resampler = RESAMPLER): { id: string; cells: Cell[] }[] {
  const { benchmarkSpan } = table.benchmark;
  return [
    ...table.factors.map((factor) => ({
      id: `identity/${factor}x`,
      cells: table.spans.flatMap((span) => [cell('a', factor, span), cell('b', factor, span)]),
    })),
    ...table.factors.map((factor) => ({
      id: `core/${factor}x`,
      cells: (['a', 'b', 'c', 'd'] as const).map((v) => cell(v, factor, benchmarkSpan)),
    })),
  ];
}
