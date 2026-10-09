// The alias reading: a Blackman–Harris power spectrum of a steady tone of
// known fundamental, split into the harmonic bins (k·f0, ± the window's main
// lobe) and everything else in 20 Hz – 20 kHz. Every non-harmonic bin of a
// static shaper on a periodic input is aliasing (or the input's own floor,
// which is read the same way and reported beside it).

export const SR = 48000;
export const N = 1 << 16;
/** Bins either side of a harmonic counted as that harmonic: the 4-term window's main lobe is ±4. */
const W = 6;
const BAND_LO = 20;
const BAND_HI = 20000;
/** Harmonics compared against the reference for tone, up to this frequency. */
export const TONE_HI = 16000;

function fft(re: Float64Array, im: Float64Array): void {
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
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const WINDOW = (() => {
  const w = new Float64Array(N);
  const [a0, a1, a2, a3] = [0.35875, 0.48829, 0.14128, 0.01168];
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / (N - 1);
    w[i] = a0 - a1 * Math.cos(t) + a2 * Math.cos(2 * t) - a3 * Math.cos(3 * t);
  }
  return w;
})();

/** One-sided power per bin of `x[start .. start + N)`. */
export function powerSpectrum(x: Float64Array, start: number): Float64Array {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[start + i] * WINDOW[i];
  fft(re, im);
  const p = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}

/** IEC 61672 A-weighting as a power gain. */
function aWeight(f: number): number {
  const f2 = f * f;
  const ra =
    (12194 ** 2 * f2 * f2) /
    ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  const ra1k = 0.7943282347242815; // R_A(1 kHz), so the weight is 0 dB there
  return (ra / ra1k) ** 2;
}

const BIN_HZ = SR / N;
const WEIGHT = Float64Array.from({ length: N / 2 }, (_, k) => aWeight(Math.max(k, 1) * BIN_HZ));

export interface Reading {
  /** Non-harmonic power over harmonic power, 20 Hz – 20 kHz, dB. */
  asr: number;
  /** The same with both A-weighted: how loud the aliasing is next to the note, as heard. */
  asrA: number;
  /** The strongest non-harmonic bin against the strongest harmonic, dB. */
  worst: number;
  /** Each harmonic's power below TONE_HI, dB, for the tone comparison. */
  harmonics: number[];
}

function harmonicMask(f0: number): Uint8Array {
  const mask = new Uint8Array(N / 2);
  for (let h = f0; h < SR / 2; h += f0) {
    const c = Math.round(h / BIN_HZ);
    for (let k = Math.max(0, c - W); k <= Math.min(N / 2 - 1, c + W); k++) mask[k] = 1;
  }
  return mask;
}

export function read(x: Float64Array, start: number, f0: number): Reading {
  const p = powerSpectrum(x, start);
  const mask = harmonicMask(f0);
  const lo = Math.ceil(BAND_LO / BIN_HZ);
  const hi = Math.floor(BAND_HI / BIN_HZ);
  let ph = 0, pa = 0, phA = 0, paA = 0, peakH = 0, peakA = 0;
  for (let k = lo; k <= hi; k++) {
    if (mask[k]) {
      ph += p[k];
      phA += p[k] * WEIGHT[k];
      if (p[k] > peakH) peakH = p[k];
    } else {
      pa += p[k];
      paA += p[k] * WEIGHT[k];
      if (p[k] > peakA) peakA = p[k];
    }
  }
  const harmonics: number[] = [];
  for (let h = f0; h < TONE_HI; h += f0) {
    const c = Math.round(h / BIN_HZ);
    let e = 0;
    for (let k = c - W; k <= c + W; k++) e += p[k];
    harmonics.push(10 * Math.log10(e + 1e-300));
  }
  const db = (a: number, b: number) => 10 * Math.log10((a + 1e-300) / (b + 1e-300));
  return { asr: db(pa, ph), asrA: db(paA, phA), worst: db(peakA, peakH), harmonics };
}
