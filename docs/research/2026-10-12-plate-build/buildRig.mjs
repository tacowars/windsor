// The plate's onset rig (windsor#761): loads a reverb-processor.js bundle by
// path under a stand-in AudioWorkletGlobalScope at any sample rate, renders
// it a quantum at a time, and reads the onset figures the note tables: first
// arrival, time to the wet envelope's peak, early energy, wet RMS, T30.
import { readFileSync } from 'node:fs';

export const BLOCK = 128;
/** Seconds the plate settles at its Size and Build before the click. */
export const SETTLE = 0.5;
/** The wet envelope's analysis window, seconds. */
export const WINDOW = 0.01;

/** The spaces the note measures, copied from `mixer/reverbSpace.ts` (SPACES). */
export const SPACES = {
  default: {},
  plate: {
    size: 0.5,
    decay: 1.25,
    preDelay: 0.005,
    inputLowCut: 100,
    inputHighCut: 12000,
    tankLowCut: 120,
    tankHighCut: 7000,
    modRate: 1,
    modDepth: 0.5,
  },
  hall: {
    size: 1.4,
    decay: 6.35,
    preDelay: 0.025,
    inputLowCut: 60,
    tankLowCut: 60,
    tankHighCut: 6500,
    modDepth: 0.8,
  },
};

class Base {
  constructor() {
    this.port = { postMessage() {}, onmessage: null };
  }
}

export function loadPlate(file, sampleRate = 48000) {
  let Processor;
  const source = readFileSync(file, 'utf8');
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source)(
    Base,
    sampleRate,
    (_name, cls) => {
      Processor = cls;
    },
  );
  return { Processor, sampleRate, descriptors: Processor.parameterDescriptors };
}

/**
 * Render `seconds` after a `settle`; `feed(block, l, r, rate)` writes input
 * (default: one click at the end of the settle), `automate(block, values,
 * proc)` moves parameters. Returns the outputs from the click on.
 */
export function render(plate, seconds, params, opts = {}) {
  const { feed, automate, options = {}, settle = SETTLE } = opts;
  const settleBlocks = Math.round((settle * plate.sampleRate) / BLOCK);
  const input = feed ?? ((block, l, r) => {
    if (block === settleBlocks) l[0] = r[0] = 1;
  });
  const proc = new plate.Processor({ processorOptions: options });
  const values = {};
  for (const d of plate.descriptors) {
    values[d.name] = new Float32Array([params[d.name] ?? d.defaultValue]);
  }
  const skip = feed ? 0 : settleBlocks;
  const blocks = Math.ceil((seconds * plate.sampleRate) / BLOCK) + skip;
  const L = new Float32Array((blocks - skip) * BLOCK);
  const R = new Float32Array((blocks - skip) * BLOCK);
  const inL = new Float32Array(BLOCK);
  const inR = new Float32Array(BLOCK);
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  let maxStep = 0;
  let previous = 0;
  for (let b = 0; b < blocks; b++) {
    inL.fill(0);
    inR.fill(0);
    outL.fill(0);
    outR.fill(0);
    if (automate) automate(b, values, proc);
    input(b, inL, inR, plate.sampleRate);
    proc.process([[inL, inR]], [[outL, outR]], values);
    for (let i = 0; i < BLOCK; i++) {
      if (b > 4) maxStep = Math.max(maxStep, Math.abs(outL[i] - previous));
      previous = outL[i];
    }
    if (b < skip) continue;
    L.set(outL, (b - skip) * BLOCK);
    R.set(outR, (b - skip) * BLOCK);
  }
  return { L, R, proc, maxStep };
}

/** Windows either side of each 10 ms window that the wet envelope averages over. */
export const SMOOTH_WINDOWS = 2;
/** How close to its peak the envelope must come, in dB, for the rise time. */
export const RISE_DB = 1;

/**
 * The onset of a click's render, each from the end of the pre-delay, times
 * in ms:
 * - `firstMs`, the first arrival: the first sample above −40 dB of the wet peak;
 * - `peakMs`, the start of the 10 ms window of most energy;
 * - `riseMs`, the time to the peak: the start of the first window at which
 *   the wet envelope (each 10 ms window's energy averaged over the
 *   SMOOTH_WINDOWS either side) comes within RISE_DB of its peak. With a
 *   long Decay the envelope plateaus within ±1 dB for hundreds of ms after
 *   it has built, and the single loudest window wanders inside it;
 * - `e20` and `e100`, the energy (L² + R²) in the first 20 and 100 ms;
 * - `rms1s`, the wet RMS over the first second.
 * The envelope is read over the first second.
 */
export function onset({ L, R }, rate, preDelay = 0) {
  const from = Math.round(preDelay * rate);
  let peak = 0;
  for (let i = from; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const floor = peak * 10 ** (-40 / 20);
  let first = -1;
  for (let i = from; i < L.length && first < 0; i++) {
    if (Math.abs(L[i]) > floor || Math.abs(R[i]) > floor) first = i - from;
  }
  const energy = (ms) => {
    let e = 0;
    const to = Math.min(L.length, from + Math.round((ms / 1000) * rate));
    for (let i = from; i < to; i++) e += L[i] * L[i] + R[i] * R[i];
    return e;
  };
  const win = Math.round(WINDOW * rate);
  const windows = [];
  for (let w = 0; from + (w + 1) * win <= L.length && w * WINDOW < 1 - 1e-9; w++) {
    let e = 0;
    for (let i = from + w * win; i < from + (w + 1) * win; i++) e += L[i] * L[i] + R[i] * R[i];
    windows.push(e);
  }
  const envelope = windows.map((_, w) => {
    let sum = 0;
    let n = 0;
    for (let k = w - SMOOTH_WINDOWS; k <= w + SMOOTH_WINDOWS; k++) {
      if (k < 0 || k >= windows.length) continue;
      sum += windows[k];
      n++;
    }
    return sum / n;
  });
  const top = Math.max(...envelope);
  const rise = envelope.findIndex((e) => e >= top * 10 ** (-RISE_DB / 10));
  const second = Math.min(L.length - from, rate);
  return {
    firstMs: (first / rate) * 1000,
    peakMs: windows.indexOf(Math.max(...windows)) * WINDOW * 1000,
    riseMs: rise * WINDOW * 1000,
    e20: energy(20),
    e100: energy(100),
    rms1s: Math.sqrt(energy(1000) / (2 * second)),
  };
}

/** T30 in seconds from the Schroeder integral of L² + R²; NaN short of −35 dB. */
export function t30(L, R, rate) {
  const n = L.length;
  const decay = new Float64Array(n);
  let sum = 0;
  for (let i = n - 1; i >= 0; i--) {
    sum += L[i] * L[i] + R[i] * R[i];
    decay[i] = sum;
  }
  const total = decay[0];
  let st = 0, sd = 0, stt = 0, std = 0, count = 0;
  for (let i = 0; i < n; i++) {
    const db = 10 * Math.log10(decay[i] / total);
    if (db > -5) continue;
    if (db < -35) return -60 / ((count * std - st * sd) / (count * stt - st * st));
    const t = i / rate;
    st += t;
    sd += db;
    stt += t * t;
    std += t * db;
    count++;
  }
  return NaN;
}

export const dB = (ratio) => 10 * Math.log10(ratio);
