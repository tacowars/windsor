/* global structuredClone, URL */
/**
 * The shipped Transient bundle under Node, for the sweep and the listen
 * (record `2026-10-18-transient-insert`): `worklet/generated/transient-processor.js`
 * evaluated with the three worklet-scope names shimmed, as the tests' harness
 * does, so what these scripts measure is what the browser plays. Research only.
 */
import { readFileSync } from 'node:fs';
// Node 24 strips the table's types itself: it imports nothing.
import {
  TRANSIENT_SHIPPED_TIMING,
  TRANSIENT_TIMINGS,
} from '../../../packages/engine/src/inserts/transientTables.ts';

const ENGINE = new URL('../../../packages/engine/src/', import.meta.url);
const BLOCK = 128;

/** The timing rows, and the one that ships, from `inserts/transientTables.ts`. */
export const TIMINGS = TRANSIENT_TIMINGS;
export const SHIPPED = TRANSIENT_SHIPPED_TIMING;

const DEFAULTS = { attack: 0, sustain: 0, output: 0, mix: 1, enabled: 1 };

/** The processor class for `rate`, from the shipped bundle. */
function processorClass(rate) {
  const source = readFileSync(new URL('worklet/generated/transient-processor.js', ENGINE), 'utf8');
  class Base {
    constructor() {
      this.port = {
        posted: [],
        postMessage(message) {
          this.posted.push(structuredClone(message));
        },
        onmessage: null,
        close() {},
      };
    }
  }
  let Processor = null;
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source)(
    Base,
    rate,
    (_name, cls) => (Processor = cls),
  );
  return Processor;
}

/** A Transient at `rate` over `settings`, with its live params and the `timing` row when given. */
export function transient(rate, settings = {}, timing) {
  const values = { ...DEFAULTS, ...settings };
  const params = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, new Float32Array([Number(v)])]),
  );
  const Processor = processorClass(rate);
  const processor = new Processor({
    parameterData: values,
    processorOptions: timing ? { timing } : {},
  });
  return { processor, params };
}

/**
 * Stereo `[left, right]` through `insert` a quantum at a time; `each(quantum, params)`
 * may move a param before its quantum. Returns the two output channels.
 */
export function render(insert, [left, right], each = () => {}) {
  const frames = Math.ceil(left.length / BLOCK) * BLOCK;
  const out = [new Float32Array(frames), new Float32Array(frames)];
  for (let at = 0; at < frames; at += BLOCK) {
    each(at / BLOCK, insert.params);
    const input = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    input[0].set(left.subarray(at, at + BLOCK));
    input[1].set(right.subarray(at, at + BLOCK));
    const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    insert.processor.process([input], [output], insert.params);
    out[0].set(output[0], at);
    out[1].set(output[1], at);
  }
  return out;
}

/** The synthetic hit: silence to `onset`, then `peak` · e^(−t/τ) · cos(2π·220·t), τ = 80 ms. */
export function hit(rate, { seconds = 1, onset = 0.01, peak = 0.5, tau = 0.08, hz = 220 } = {}) {
  const frames = Math.round(seconds * rate);
  const start = Math.round(onset * rate);
  const x = new Float32Array(frames);
  for (let i = start; i < frames; i++) {
    const t = (i - start) / rate;
    x[i] = peak * Math.exp(-t / tau) * Math.cos(2 * Math.PI * hz * t);
  }
  return { signal: [x, Float32Array.from(x)], start };
}

/** A steady sine of `hz` at `peak`. */
export function sine(rate, hz, { seconds = 3, peak = 0.5 } = {}) {
  const x = Float32Array.from(
    { length: Math.round(seconds * rate) },
    (_, i) => peak * Math.sin((2 * Math.PI * hz * i) / rate),
  );
  return [x, Float32Array.from(x)];
}

/** The gain sample `i` took, in dB: output over input. */
export const gainAt = (input, output, i) => 20 * Math.log10(Math.abs(output[i] / input[i]));
