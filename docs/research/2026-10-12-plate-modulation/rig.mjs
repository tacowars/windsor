/* global process, URL */
// The measuring rig for windsor#764 (the plate's tank modulation): loads a
// reverb-processor.js bundle under a stand-in AudioWorkletGlobalScope, renders
// it a quantum at a time, and reads the spread, the envelope and the T30.
// Variants: 'new' is the repository's bundle; 'main' is main's at ca06820,
// written beside this file with
//   git show ca06820:packages/engine/src/worklet/generated/reverb-processor.js > main-reverb.js
// (or named by MAIN_BUNDLE); 'cubiclong' is the new bundle with the four long
// lines (5, 7, 9, 11) read cubic as well, the HOLD experiment in the README.
import { readFileSync } from 'node:fs';

export const BUNDLES = {
  main: process.env.MAIN_BUNDLE ?? new URL('./main-reverb.js', import.meta.url),
  new: new URL('../../../packages/engine/src/worklet/generated/reverb-processor.js', import.meta.url),
};
export const BLOCK = 128;

class Base {
  constructor() {
    this.port = { postMessage() {}, onmessage: null };
  }
}

const cache = new Map();
/** variant: 'main' | 'new' | 'cubiclong' */
export function loadPlate(variant, rate = 48000) {
  const key = `${variant}@${rate}`;
  if (cache.has(key)) return cache.get(key);
  let src = readFileSync(variant === 'main' ? BUNDLES.main : BUNDLES.new, 'utf8');
  if (variant === 'cubiclong') {
    for (const n of [5, 7, 9, 11]) src = src.replace(`this._read(${n}, 0);`, `this._offset = 0; this._readCubic(${n});`);
  }
  let Proc;
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', src)(
    Base,
    rate,
    (_n, c) => (Proc = c),
  );
  const plate = { Proc, rate, descriptors: Proc.parameterDescriptors };
  cache.set(key, plate);
  return plate;
}

/**
 * Render `seconds`; feed(b, L, R, rate) writes input; automate(b, values) moves params.
 * Returns { L, R } Float32Arrays of the whole render.
 */
export function render(plate, seconds, feed, params = {}, automate) {
  const p = new plate.Proc({ processorOptions: {} });
  const values = {};
  for (const d of plate.descriptors) values[d.name] = new Float32Array([params[d.name] ?? d.defaultValue]);
  const blocks = Math.round((seconds * plate.rate) / BLOCK);
  const L = new Float32Array(blocks * BLOCK);
  const R = new Float32Array(blocks * BLOCK);
  const inL = new Float32Array(BLOCK), inR = new Float32Array(BLOCK);
  const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK);
  for (let b = 0; b < blocks; b++) {
    inL.fill(0); inR.fill(0);
    if (automate) automate(b, values, p);
    if (feed) feed(b, inL, inR, plate.rate);
    outL.fill(0); outR.fill(0);
    p.process([[inL, inR]], [[outL, outR]], values);
    L.set(outL, b * BLOCK); R.set(outR, b * BLOCK);
  }
  return { L, R, processor: p };
}

export const sine = (hz, amp = 0.3, until = Infinity) => (b, l, r, rate) => {
  for (let i = 0; i < BLOCK; i++) {
    const n = b * BLOCK + i;
    if (n / rate >= until) return;
    l[i] = r[i] = Math.sin((2 * Math.PI * hz * n) / rate) * amp;
  }
};

export const impulseAt = (block) => (b, l, r) => {
  if (b === block) { l[0] = 1; r[0] = 1; }
};

// ---- analysis ----

/** In-place radix-2 FFT on re/im Float64Arrays. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Welch PSD (Hann, 50 % overlap) of x; returns Float64Array of n/2+1 bins. */
export function welch(x, n = 16384) {
  const psd = new Float64Array(n / 2 + 1);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const re = new Float64Array(n), im = new Float64Array(n);
  let count = 0;
  for (let s = 0; s + n <= x.length; s += n / 2) {
    for (let i = 0; i < n; i++) { re[i] = x[s + i] * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= n / 2; k++) psd[k] += re[k] * re[k] + im[k] * im[k];
    count++;
  }
  for (let k = 0; k <= n / 2; k++) psd[k] /= count;
  return psd;
}

/** RMS spectral width (Hz) of x within ±half Hz of centre, Welch. */
export function spreadHz(x, rate, centre = 1000, half = 250, n = 16384) {
  const psd = welch(x, n);
  let p = 0, m = 0;
  for (let k = 0; k < psd.length; k++) {
    const f = (k * rate) / n;
    if (Math.abs(f - centre) > half) continue;
    p += psd[k]; m += psd[k] * (f - centre) ** 2;
  }
  return Math.sqrt(m / p);
}

/** RMS in windows of `win` samples. */
export function envelope(x, win) {
  const out = new Float64Array(Math.floor(x.length / win));
  for (let w = 0; w < out.length; w++) {
    let e = 0;
    for (let i = 0; i < win; i++) e += x[w * win + i] ** 2;
    out[w] = Math.sqrt(e / win);
  }
  return out;
}

/**
 * Strongest component of the envelope between lo and hi Hz, as amplitude
 * relative to the envelope's mean, in dB. envRate = envelope samples per s.
 */
export function envelopePeak(env, envRate, lo = 0.1, hi = 10) {
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  let n = 1;
  while (n < env.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  // Hann window, zero padded
  let wsum = 0;
  for (let i = 0; i < env.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (env.length - 1));
    re[i] = (env[i] - mean) * w; wsum += w;
  }
  fft(re, im);
  let best = 0, at = 0;
  for (let k = 1; k < n / 2; k++) {
    const f = (k * envRate) / n;
    if (f < lo || f > hi) continue;
    const a = (2 * Math.hypot(re[k], im[k])) / wsum;
    if (a > best) { best = a; at = f; }
  }
  return { db: 20 * Math.log10(best / mean), hz: at };
}

/** Schroeder T30 over L and R. */
export function t30(left, right, rate) {
  const n = left.length;
  const decay = new Float64Array(n);
  let sum = 0;
  for (let i = n - 1; i >= 0; i--) { sum += left[i] ** 2 + right[i] ** 2; decay[i] = sum; }
  const total = decay[0];
  let st = 0, sd = 0, stt = 0, std = 0, count = 0;
  for (let i = 0; i < n; i++) {
    const db = 10 * Math.log10(decay[i] / total);
    if (db > -5) continue;
    if (db < -35) { const slope = (count * std - st * sd) / (count * stt - st * st); return -60 / slope; }
    const t = i / rate;
    st += t; sd += db; stt += t * t; std += t * db; count++;
  }
  return NaN;
}

export const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
