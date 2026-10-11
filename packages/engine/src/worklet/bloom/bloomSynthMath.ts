/* eslint-disable no-magic-numbers -- the in-place slots' offsets and the three half angles (×8) */
/**
 * The synthesis's per-step arithmetic (`bloomSynth.ts`), in place on
 * `Float64Array` slots, so no double crosses a call; nothing allocates, no
 * transcendental `Math` (rule 6).
 *
 * - `bloomTurnInPlace`: the angle of (x, y), in turns [0, 1): three half
 *   angles by √ bring it within ±π/8, then atan's series (error under
 *   1e-14 rad). Branch-free, so a rare call never deoptimises it.
 * - `bloomDarkeningInPlace`: the band's darkening one-pole for corner fp at
 *   rate fs: a pole a = e^{−2π·fp/fs} and a zero −b placed so the gain is
 *   the analog pole's at DC and at Nyquist, y = c·(x + b·x₁) + a·y₁; the
 *   gain g that makes it 1 at the band's fundamental (cos ω₀, sin ω₀ given),
 *   and its lag there in turns, which the synthesis leads the band's phase
 *   by, so the fundamental is the same in level and phase at every corner. Within
 *   1 dB of 1/|1 + j·f/fp| up to 0.45·fs, the same shape of error at every
 *   fp, which `bloomTone.ts`'s fixed filter takes out.
 */
import { exp2InPlace } from '../fm/portablePowers';

/** atan's series, x Σ (−1)^j x^{2j}/(2j + 1), for |x| ≤ tan(π/8). */
const BLOOM_TURN_TERMS = 12;
const BLOOM_TURN_SERIES = new Float64Array(BLOOM_TURN_TERMS);
for (let j = 0; j < BLOOM_TURN_TERMS; j++)
  BLOOM_TURN_SERIES[j] = (j % 2 === 0 ? 1 : -1) / (2 * j + 1);
/** Keeps y/(x + r) finite on the negative x axis (read as angle 0 there, a set of measure zero). */
const BLOOM_TURN_GUARD = 1e-300;
const BLOOM_TURN = 2 * Math.PI;

/** The angle of (`values[at]`, `values[at + 1]`) in turns, [0, 1), into `values[at]`. */
function bloomTurnInPlace(values: Float64Array, at: number): void {
  const x = values[at],
    y = values[at + 1];
  // Three half angles, tan(θ/2) = y/(x + r), then tan(φ/2) = t/(1 + √(1 + t²)): θ/8 within ±π/8.
  // No branch, so the function never meets a path it has no feedback for (its rare calls are rare paths).
  const r = Math.sqrt(x * x + y * y);
  const half = y / (x + r + BLOOM_TURN_GUARD);
  const quarter = half / (1 + Math.sqrt(1 + half * half));
  const eighth = quarter / (1 + Math.sqrt(1 + quarter * quarter));
  const t2 = eighth * eighth,
    series = BLOOM_TURN_SERIES;
  let sum = series[BLOOM_TURN_TERMS - 1];
  for (let j = BLOOM_TURN_TERMS - 2; j >= 0; j--) sum = sum * t2 + series[j];
  const turn = (8 * eighth * sum) / BLOOM_TURN;
  values[at] = turn - Math.floor(turn);
}

/**
 * From fp = `values[at]`, fs = `values[at + 1]`, cos ω₀ = `values[at + 2]`
 * and sin ω₀ = `values[at + 3]`: a, b, c, the fundamental's gain g and its
 * lag in turns into `values[at]` … `values[at + 4]` (`values[at + 5]` is
 * working room).
 */
function bloomDarkeningInPlace(values: Float64Array, at: number): void {
  // Nothing stays live across the 2^x call (a double held across a call is boxed below the top tier):
  // the Nyquist ratio waits in the working slot, the rest are read back after.
  const ratio = values[at + 1] / (2 * values[at]);
  values[at + 5] = ratio;
  values[at] = (-BLOOM_TURN * values[at] * Math.LOG2E) / values[at + 1];
  exp2InPlace(values, at);
  const a = values[at],
    cos0 = values[at + 2],
    sin0 = values[at + 3],
    r = values[at + 5];
  const nyquist = 1 / Math.sqrt(1 + r * r);
  const rho = (nyquist * (1 + a)) / (1 - a);
  const b = (1 - rho) / (1 + rho),
    c = (1 - a) / (1 + b);
  const num = 1 + b * b + 2 * b * cos0,
    den = 1 + a * a - 2 * a * cos0;
  values[at + 1] = b;
  values[at + 2] = c;
  values[at + 3] = Math.sqrt(den / num) / c;
  // arg H(e^{iω₀}) = arg((1 + b e^{−iω₀}) · conj(1 − a e^{−iω₀})); its lag is −arg, the turn of the conjugate.
  const nr = 1 + b * cos0,
    ni = -b * sin0,
    dr = 1 - a * cos0,
    di = a * sin0;
  values[at + 4] = nr * dr + ni * di;
  values[at + 5] = -(ni * dr - nr * di);
  bloomTurnInPlace(values, at + 4);
}

export { bloomDarkeningInPlace, bloomTurnInPlace };
