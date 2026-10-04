/**
 * The Acid Ladder's analog reference (windsor#573, record
 * `2026-10-04-acid-ladder-filter-mode`, research
 * `docs/research/2026-10-04-acid-ladder-filter/`): Stinchcombe's TB-303
 * polynomial D(s), the response 1 / (D(s) + k HP(s)) with the feedback's
 * one-pole high-pass, read at a digital frequency's bilinear image so the
 * warp is not counted as error, the feedback at which that loop
 * self-oscillates, the output mix's factor 1 + g HP(s) (windsor#577), and
 * a 4 × 4 matrix's characteristic polynomial. The
 * ladder's own output is −x₄; the shipped mode negates it, so the response
 * here is the mode's, with the inversion undone. `ladder.test.ts` and
 * `synth/fmProcessorFilterLadder.test.ts` hold the shipped filter to it.
 */

/** A complex number as [re, im]. */
type Complex = [number, number];

const mul = (a: Complex, b: Complex): Complex => [
  a[0] * b[0] - a[1] * b[1],
  a[0] * b[1] + a[1] * b[0],
];
const div = (a: Complex, b: Complex): Complex => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};

/**
 * Stinchcombe's G_tb denominator in units of ω_c = 2^¼ / τ, highest power
 * first: the chain's s⁴ + 8 s³ + 20 s² + 16 s + 2 (τ = 1) halved and scaled,
 * s⁴ + 6.727 s³ + 14.142 s² + 9.514 s + 1.
 */
export const LADDER_POLYNOMIAL: readonly number[] = [
  1,
  4 * 2 ** 0.75,
  10 * Math.SQRT2,
  8 * 2 ** 0.25,
  1,
];

/** D(jw), w in units of ω_c. */
function polynomialAt(w: number): Complex {
  let acc: Complex = [0, 0];
  for (const c of LADDER_POLYNOMIAL) {
    const m = mul(acc, [0, w]);
    acc = [m[0] + c, m[1]];
  }
  return acc;
}

/** A frequency's bilinear image at `rate`, as tan(π f / f_s): the analog frequency over 2 f_s. */
export const bilinearImage = (hz: number, rate: number): number => Math.tan((Math.PI * hz) / rate);

/** One reading of the response: its gain in dB and its phase in degrees. */
export interface Response {
  db: number;
  degrees: number;
}

/**
 * The mode's analog response at `hz` for a ladder at cutoff `cutoffHz` and
 * feedback `k`, its high-pass at `hpHz`, every frequency read at its
 * bilinear image at `rate`: 1 / (D(jw) + k jw / (jw + w_hp)).
 */
export function ladderResponse(
  hz: number,
  cutoffHz: number,
  k: number,
  rate: number,
  hpHz: number,
): Response {
  const wc = bilinearImage(cutoffHz, rate);
  const w = bilinearImage(hz, rate) / wc;
  const whp = bilinearImage(hpHz, rate) / wc;
  const hp = div([0, w], [whp, w]);
  const d = polynomialAt(w);
  const h = div([1, 0], [d[0] + k * hp[0], d[1] + k * hp[1]]);
  return {
    db: 10 * Math.log10(h[0] * h[0] + h[1] * h[1]),
    degrees: (Math.atan2(h[1], h[0]) * 180) / Math.PI,
  };
}

/** The output mix (windsor#577): its gain, `LADDER_MIX_GAIN` × p, and its high-pass's corner in Hz. */
export interface OutputMix {
  gain: number;
  hpHz: number;
}

/**
 * The mode's analog response at `hz` with the output mix: `ladderResponse`
 * times 1 + g jw / (jw + w_mix), w_mix at its bilinear image at `rate` too.
 */
export function mixedLadderResponse(
  hz: number,
  ladder: { cutoffHz: number; k: number; hpHz: number },
  mix: OutputMix,
  rate: number,
): Response {
  const loop = ladderResponse(hz, ladder.cutoffHz, ladder.k, rate, ladder.hpHz);
  const w = bilinearImage(hz, rate);
  const hp = div([0, w], [bilinearImage(mix.hpHz, rate), w]);
  const factor: Complex = [1 + mix.gain * hp[0], mix.gain * hp[1]];
  const radians = Math.atan2(factor[1], factor[0]);
  return {
    db: loop.db + 10 * Math.log10(factor[0] * factor[0] + factor[1] * factor[1]),
    degrees: loop.degrees + (radians * 180) / Math.PI,
  };
}

/**
 * The feedback k at which the loop with the high-pass self-oscillates at
 * cutoff `cutoffHz`, both corners at their bilinear images at `rate`: where
 * D(jw) (jw + w_hp) / (jw) is real and negative, k is its magnitude.
 */
export function thresholdK(cutoffHz: number, rate: number, hpHz: number): number {
  const whp = bilinearImage(hpHz, rate) / bilinearImage(cutoffHz, rate);
  const ratio = (w: number): Complex => div(mul(polynomialAt(w), [whp, w]), [0, w]);
  // The phase crosses 180° once near 2^¼ ω_c; bisect on the imaginary part's sign.
  let lo = 0.5;
  let hi = 2;
  const sign = Math.sign(ratio(lo)[1]);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sign(ratio(mid)[1]) === sign) lo = mid;
    else hi = mid;
  }
  return -ratio(lo)[0];
}

/** det(sI − M) of a 4 × 4 `M`, highest power first, by Faddeev–LeVerrier. */
export function characteristicPolynomial(m: number[][]): number[] {
  const n = m.length;
  const product = (a: number[][], b: number[][]): number[][] =>
    a.map((row) => b[0]!.map((_, j) => row.reduce((sum, v, k) => sum + v * b[k]![j]!, 0)));
  const trace = (a: number[][]): number => a.reduce((sum, row, i) => sum + row[i]!, 0);
  const powers = [m];
  for (let k = 1; k < n; k++) powers.push(product(powers[k - 1]!, m));
  const e = [1];
  for (let k = 1; k <= n; k++) {
    let sum = 0;
    for (let i = 1; i <= k; i++) sum += (i % 2 === 1 ? 1 : -1) * e[k - i]! * trace(powers[i - 1]!);
    e.push(sum / k);
  }
  return e.map((v, k) => (k % 2 === 1 ? -v : v));
}

/** The inverse of a square matrix, by Gauss–Jordan with partial pivoting. */
export function inverse(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    [a[c], a[p]] = [a[p]!, a[c]!];
    const pivot = a[c]![c]!;
    for (let j = 0; j < 2 * n; j++) a[c]![j]! /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r]![c]!;
      for (let j = 0; j < 2 * n; j++) a[r]![j]! -= f * a[c]![j]!;
    }
  }
  return a.map((row) => row.slice(n));
}
