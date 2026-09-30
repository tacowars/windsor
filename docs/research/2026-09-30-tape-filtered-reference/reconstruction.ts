/** Original continuous Blackman-sinc reconstruction, not imported dependency code.
 * H and dH/d(host sample) come from one kernel; causal support is [0, span].
 * Offline allocations are intentional. Pinned by tapeFilteredReference.test.mjs.
 */
import { EXPERIMENT as E, FILTERED as F } from './filteredConstants';

export function kernel(t: number): [number, number] {
  const half = E.firSpan / 2;
  if (Math.abs(t) >= half) return [0, 0];
  const a = 2 * Math.PI * E.cutoff;
  const z = a * t;
  const sinc =
    Math.abs(z) < F.kernelSeriesRadius ? 1 - (z * z) / 6 + z ** 4 / 120 : Math.sin(z) / z;
  const derivative =
    Math.abs(z) < F.kernelSeriesRadius
      ? a * (-z / 3 + z ** 3 / 30)
      : (a * (z * Math.cos(z) - Math.sin(z))) / (z * z);
  const b = Math.PI / half;
  const w = 0.42 + 0.5 * Math.cos(b * t) + 0.08 * Math.cos(2 * b * t);
  const wd = -0.5 * b * Math.sin(b * t) - 0.16 * b * Math.sin(2 * b * t);
  return [2 * E.cutoff * sinc * w, 2 * E.cutoff * (derivative * w + sinc * wd)];
}

export function normalization(panels = F.normalizationPanels): number {
  let sum = 0;
  for (let i = 0; i <= panels; i++) {
    const weight = i === 0 || i === panels ? 1 : i % 2 ? 4 : 2;
    sum += weight * kernel(E.firSpan * (i / panels - 0.5))[0];
  }
  return (sum * E.firSpan) / (3 * panels);
}
export const NORM = normalization();

/** Direct finite host-sample sum. Negative host history is zero, not periodic. */
export function reconstruct(t: number, input: (n: number) => number): [number, number] {
  let h = 0,
    d = 0;
  for (let n = Math.ceil(t - E.firSpan); n <= Math.floor(t); n++) {
    const [value, derivative] = kernel(t - n - E.firSpan / 2);
    const x = n < 0 ? 0 : input(n);
    h += x * value;
    d += x * derivative;
  }
  return [h / NORM, d / NORM];
}

/** Precomputed exact kernel evaluations, not an interpolated derivative table.
 * Coherent periodic forcing is reused only after the causal startup support.
 */
export class Field {
  readonly steady: Float64Array;
  readonly startup: Float64Array;
  constructor(
    readonly bins: number[],
    readonly grid: number,
  ) {
    const input = Float64Array.from(
      { length: E.frames },
      (_, n) =>
        bins.reduce((s, bin) => s + Math.sin((2 * Math.PI * bin * n) / E.frames), 0) / bins.length,
    );
    this.steady = new Float64Array(2 * E.frames * grid);
    this.startup = new Float64Array(2 * E.firSpan * grid);
    for (let phase = 0; phase < grid; phase++) {
      const weights = Array.from({ length: E.firSpan + 1 }, (_, j) =>
        kernel(phase / grid + j - E.firSpan / 2),
      );
      for (let n = 0; n < E.frames; n++) {
        let h = 0,
          d = 0,
          sh = 0,
          sd = 0;
        for (let j = 0; j <= E.firSpan; j++) {
          const x = input[(n - j + E.frames) % E.frames];
          const [k, kd] = weights[j];
          h += x * k;
          d += x * kd;
          if (n >= j) {
            sh += x * k;
            sd += x * kd;
          }
        }
        const index = 2 * (n * grid + phase);
        this.steady[index] = h / NORM;
        this.steady[index + 1] = d / NORM;
        if (n < E.firSpan) {
          this.startup[index] = sh / NORM;
          this.startup[index + 1] = sd / NORM;
        }
      }
    }
  }
  at(index: number, derivative = false): number {
    const offset = derivative ? 1 : 0;
    return index * 2 < this.startup.length
      ? this.startup[2 * index + offset]
      : this.steady[2 * (index % (E.frames * this.grid)) + offset];
  }
}
