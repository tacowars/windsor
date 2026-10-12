// The plate's stereo rig (windsor#763): loads a reverb-processor.js bundle by
// path under a stand-in AudioWorkletGlobalScope at any sample rate, renders
// it a quantum at a time with a stereo feed, and keeps both wet channels.
// `patch` rewrites the bundle's source before it runs, which is how
// `chains.mjs` tries candidate right-chain lengths without a rebuild.
import { readFileSync } from 'node:fs';

export const BLOCK = 128;

class Base {
  constructor() {
    this.port = { postMessage() {}, onmessage: null };
  }
}

export function loadPlate(file, sampleRate = 48000, patch) {
  let Processor;
  let source = readFileSync(file, 'utf8');
  if (patch) source = patch(source);
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
 * Render `seconds`: `feed(block, l, r)` writes the input, `automate(block,
 * values, proc)` moves parameters, `channels` is how many input channels the
 * plate is handed (2, 1 or 0). Returns both wet channels and the processor.
 */
export function render(plate, seconds, params, opts = {}) {
  const { feed, automate, options = {}, channels = 2 } = opts;
  const proc = new plate.Processor({ processorOptions: options });
  const values = {};
  for (const d of plate.descriptors) {
    values[d.name] = new Float32Array([params[d.name] ?? d.defaultValue]);
  }
  const blocks = Math.ceil((seconds * plate.sampleRate) / BLOCK);
  const L = new Float32Array(blocks * BLOCK);
  const R = new Float32Array(blocks * BLOCK);
  const inL = new Float32Array(BLOCK);
  const inR = new Float32Array(BLOCK);
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  for (let b = 0; b < blocks; b++) {
    inL.fill(0);
    inR.fill(0);
    automate?.(b, values, proc);
    feed?.(b, inL, inR);
    outL.fill(0);
    outR.fill(0);
    const ins = channels === 2 ? [inL, inR] : channels === 1 ? [inL] : [];
    proc.process([ins], [[outL, outR]], values);
    L.set(outL, b * BLOCK);
    R.set(outR, b * BLOCK);
  }
  return { L, R, proc };
}

/** The harness's PRNG, full scale. */
export function noise(seed = 12345) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x80000000 - 1;
  };
}

/** The input cases of windsor#763, as a gain on each side. */
export const CASES = {
  left: [1, 0],
  right: [0, 1],
  centred: [1, 1],
  anti: [1, -1],
};

/** One click at the start of block `at`, on each side at its case's gain. */
export function clickAt(at, [gl, gr]) {
  return (b, l, r) => {
    if (b !== at) return;
    l[0] = gl;
    r[0] = gr;
  };
}

/** Noise from block `from` for `seconds`, on each side at its case's gain. */
export function noiseFrom(from, seconds, [gl, gr], rate = 48000, seed = 12345) {
  const rnd = noise(seed);
  const until = from + Math.round((seconds * rate) / BLOCK);
  return (b, l, r) => {
    if (b < from || b >= until) return;
    for (let i = 0; i < BLOCK; i++) {
      const v = rnd();
      l[i] = v * gl;
      r[i] = v * gr;
    }
  };
}

export function energy(x, from = 0, to = x.length) {
  let e = 0;
  for (let i = Math.max(0, from); i < Math.min(to, x.length); i++) e += x[i] * x[i];
  return e;
}

export const db = (ratio) => 10 * Math.log10(ratio);

/** Pearson correlation of two equal stretches. */
export function correlation(a, b, from = 0, to = a.length) {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = from; i < to; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb);
}

/** T30 in seconds of a stereo render from `from`, as the harness's `t30`. */
export function t30(L, R, from, rate) {
  const n = L.length - from;
  const decay = new Float64Array(n);
  let sum = 0;
  for (let i = n - 1; i >= 0; i--) {
    sum += L[from + i] ** 2 + R[from + i] ** 2;
    decay[i] = sum;
  }
  const total = decay[0];
  let [st, sd, stt, std, count] = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const d = 10 * Math.log10(decay[i] / total);
    if (d > -5) continue;
    if (d < -35) return -60 / ((count * std - st * sd) / (count * stt - st * st));
    const t = i / rate;
    [st, sd, stt, std, count] = [st + t, sd + d, stt + t * t, std + t * d, count + 1];
  }
  return NaN;
}
