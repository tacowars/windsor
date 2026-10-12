// The plate's measuring rig (windsor#748): loads a reverb-processor.js bundle
// by path under a stand-in AudioWorkletGlobalScope, renders it a quantum at a
// time, and reads T30 from the Schroeder integral of the output's energy.
import { readFileSync } from 'node:fs';

export const BLOCK = 128;
/** Seconds the plate settles at its Size before the impulse. */
export const SETTLE = 0.5;

class Base {
  constructor() {
    this.port = { postMessage() {}, onmessage: null };
  }
}

export function loadPlate(file, sampleRate) {
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
 * Render `seconds`; `feed(block, l, r)` writes input, `automate(block, values)`
 * moves parameters. Returns the left and right outputs.
 */
export function render(plate, seconds, params, { feed, automate, options = {}, settle = SETTLE } = {}) {
  // The plate starts at Size 1 and glides to the asked Size over about 0.3 s:
  // the impulse waits `settle` seconds, and the render returned starts with it.
  const settleBlocks = Math.round((settle * plate.sampleRate) / BLOCK);
  const input = feed ?? ((block, l, r) => impulse(block - settleBlocks, l, r));
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
  for (let b = 0; b < blocks; b++) {
    inL.fill(0);
    inR.fill(0);
    outL.fill(0);
    outR.fill(0);
    if (automate) automate(b, values, proc);
    input(b, inL, inR, plate.sampleRate);
    proc.process([[inL, inR]], [[outL, outR]], values);
    if (b < skip) continue;
    L.set(outL, (b - skip) * BLOCK);
    R.set(outR, (b - skip) * BLOCK);
  }
  return { L, R, proc };
}

export function impulse(block, l, r) {
  if (block === 0) l[0] = r[0] = 1;
}

/** RBJ biquad, in place, transposed direct form II in doubles. */
function biquad(x, kind, f0, fs, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * f0) / fs;
  const cw = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (kind === 'lp') {
    b0 = (1 - cw) / 2;
    b1 = 1 - cw;
    b2 = b0;
  } else {
    b0 = (1 + cw) / 2;
    b1 = -(1 + cw);
    b2 = b0;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cw;
  const a2 = 1 - alpha;
  const y = new Float64Array(x.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const out = (b0 / a0) * x[i] + z1;
    z1 = (b1 / a0) * x[i] - (a1 / a0) * out + z2;
    z2 = (b2 / a0) * x[i] - (a2 / a0) * out;
    y[i] = out;
  }
  return y;
}

/** An octave band around `fc`: fourth-order Linkwitz-Riley edges at fc/√2 and fc·√2. */
export function octave(x, fc, fs) {
  let y = Float64Array.from(x);
  const lo = fc / Math.SQRT2;
  const hi = fc * Math.SQRT2;
  if (hi < fs * 0.45) y = biquad(biquad(y, 'lp', hi, fs), 'lp', hi, fs);
  y = biquad(biquad(y, 'hp', lo, fs), 'hp', lo, fs);
  return y;
}

/**
 * T30 in seconds: the Schroeder integral of L² + R², a least-squares line
 * through its −5 to −35 dB span, extrapolated to 60 dB. Null when the
 * integral never reaches −35 dB in the render.
 */
export function t30(L, R, fs, { from = -5, to = -35 } = {}) {
  const n = L.length;
  const edc = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    acc += L[i] * L[i] + R[i] * R[i];
    edc[i] = acc;
  }
  const total = edc[0];
  if (!(total > 0)) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0,
    count = 0,
    reached = false;
  for (let i = 0; i < n; i++) {
    const db = 10 * Math.log10(edc[i] / total);
    if (db > from) continue;
    if (db < to) {
      reached = true;
      break;
    }
    const t = i / fs;
    sx += t;
    sy += db;
    sxx += t * t;
    sxy += t * db;
    count++;
  }
  if (!reached || count < 2) return null;
  const slope = (count * sxy - sx * sy) / (count * sxx - sx * sx);
  return -60 / slope;
}

/** Peak |sample| of both channels between `from` and `to` seconds. */
export function peakBetween(L, R, fs, from, to) {
  let peak = 0;
  for (let i = Math.floor(from * fs); i < Math.min(L.length, Math.floor(to * fs)); i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  return peak;
}

/** Largest |L[i] − L[i−1]| between `from` and `to` seconds. */
export function maxStep(L, fs, from, to) {
  let step = 0;
  for (let i = Math.max(1, Math.floor(from * fs)); i < Math.min(L.length, Math.floor(to * fs)); i++) {
    step = Math.max(step, Math.abs(L[i] - L[i - 1]));
  }
  return step;
}

/** Every combination of the axes' values, as arrays in axis order. */
export const grid = (...axes) =>
  axes.reduce((rows, axis) => rows.flatMap((row) => axis.map((value) => [...row, value])), [[]]);
