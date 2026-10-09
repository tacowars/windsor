/**
 * windsor#652's two alias metrics (decision 2). Research only.
 *
 * Synced to the note, a wave repeats at the note's period, so any component
 * that is not a harmonic of the note is folded alias. In a frame through a
 * four-term Blackman-Harris window, the energy within ±6 bins of each
 * harmonic is the signal and everything else from 20 Hz to 20 kHz the alias,
 * in dB under the signal.
 *
 * - `framed`: 8 192-sample frames, hop 2 048, from 0.5 s to the render's
 *   end; the median and p90 of the frames' figures.
 * - `stationary`: `alias.mjs`'s one frame, 32 768 samples from 0.1 s.
 */
const SR = 48000;
const HALF_WIDTH = 6;
const BAND = { from: 20, to: 20000 };

const WINDOWS = new Map();

/** A four-term Blackman-Harris window, symmetric, as `alias.mjs` draws it. */
function blackmanHarris(n) {
  if (WINDOWS.has(n)) return WINDOWS.get(n);
  const a = [0.35875, 0.48829, 0.14128, 0.01168];
  const w = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const p = (2 * Math.PI * k) / (n - 1);
    w[k] = a[0] - a[1] * Math.cos(p) + a[2] * Math.cos(2 * p) - a[3] * Math.cos(3 * p);
  }
  WINDOWS.set(n, w);
  return w;
}

/** In-place iterative radix-2 FFT. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const half = len / 2;
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(ang * k);
      const wi = Math.sin(ang * k);
      for (let i = k; i < n; i += len) {
        const ar = re[i + half] * wr - im[i + half] * wi;
        const ai = re[i + half] * wi + im[i + half] * wr;
        re[i + half] = re[i] - ar;
        im[i + half] = im[i] - ai;
        re[i] += ar;
        im[i] += ai;
      }
    }
  }
}

/** The windowed power spectrum of `x[from .. from + n)`. */
export function powerSpectrum(x, from, n) {
  const w = blackmanHarris(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) re[k] = x[from + k] * w[k];
  fft(re, im);
  const power = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
  return power;
}

/** The alias energy under the harmonic energy, in dB, of one frame playing `f0`. */
export function frameAliasDb(x, from, n, f0) {
  const power = powerSpectrum(x, from, n);
  const binHz = SR / n;
  let signal = 0;
  let alias = 0;
  for (let k = Math.ceil(BAND.from / binHz); k <= BAND.to / binHz; k++) {
    const h = Math.round((k * binHz) / f0);
    if (h >= 1 && Math.abs(k - (h * f0) / binHz) <= HALF_WIDTH) signal += power[k];
    else alias += power[k];
  }
  return 10 * Math.log10(alias / signal);
}

/** The `q` quantile of `values`, linearly interpolated. */
export function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (at - lo);
}

/** Decision 2's framed figure: the median and p90 over frames of 8 192, hop 2 048, from 0.5 s. */
export function framed(x, f0, { n = 8192, hop = 2048, start = 0.5 } = {}) {
  const figures = [];
  for (let from = Math.round(start * SR); from + n <= x.length; from += hop) {
    figures.push(frameAliasDb(x, from, n, f0));
  }
  return { median: quantile(figures, 0.5), p90: quantile(figures, 0.9), frames: figures.length };
}

/** `alias.mjs`'s stationary figure: one frame of 32 768 from 0.1 s. */
export const stationary = (x, f0) => frameAliasDb(x, 4800, 32768, f0);
