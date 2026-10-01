/* global process, console, performance */
/** windsor#296 cost check, interleaved: four shipped Tape processors per bundle, before and
 * after, alternating repeat by repeat in one process so machine load hits both alike. Each
 * bundle is evaluated as `__fixtures__/tapeHarness.ts` evaluates it. Run from the repo root
 * on Node 24, the old bundle written out first:
 *   git show 634e717:packages/engine/src/worklet/generated/tape-processor.js > /tmp/before.js
 *   node docs/research/2026-10-01-tape-continuity-cost/bench.mjs /tmp/before.js \
 *     packages/engine/src/worklet/generated/tape-processor.js <2|4> <steady|switch> 11
 * Prints one JSON line: median ms per quantum for each bundle, and the median, least and
 * greatest after / before ratio over the interleaved pairs. */
import { readFileSync } from 'node:fs';

const [beforePath, afterPath, factorArg, mode, repeatsArg] = process.argv.slice(2);
const factor = Number(factorArg),
  REPEATS = Number(repeatsArg ?? 11);
const RATE = 48000,
  Q = 128,
  SECONDS = 5,
  INSTANCES = 4;

function load(path) {
  let Ctor;
  class Base {
    port = { postMessage() {}, onmessage: null };
  }
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', 'currentFrame', readFileSync(path, 'utf8'))(
    Base,
    RATE,
    (_n, c) => (Ctor = c),
    0,
  );
  return Ctor;
}
const bundles = [load(beforePath), load(afterPath)];
const frames = RATE * SECONDS,
  quanta = frames / Q;
let seed = 204;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const program = [new Float32Array(frames), new Float32Array(frames)];
for (let n = 0; n < frames; n++) {
  const v =
    0.25 * Math.sin((2 * Math.PI * 110 * n) / RATE) +
    0.2 * Math.sin((2 * Math.PI * 1310 * n) / RATE) +
    0.05 * rand();
  program[0][n] = v;
  program[1][n] = 0.9 * v;
}

function once(Ctor) {
  const defaults = Object.fromEntries(Ctor.parameterDescriptors.map((d) => [d.name, d.defaultValue]));
  defaults.oversampling = factor;
  const procs = [],
    params = [];
  for (let i = 0; i < INSTANCES; i++) {
    params.push(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, new Float32Array([v])])));
    procs.push(new Ctor({ parameterData: { ...defaults } }));
  }
  const inL = new Float32Array(Q),
    inR = new Float32Array(Q);
  const inputs = [[inL, inR]],
    outputs = [[new Float32Array(Q), new Float32Array(Q)]];
  const start = performance.now();
  for (let q = 0; q < quanta; q++) {
    inL.set(program[0].subarray(q * Q, q * Q + Q));
    inR.set(program[1].subarray(q * Q, q * Q + Q));
    if (mode === 'switch' && q % 16 === 0) for (const p of params) p.model[0] = (q / 16) % 7;
    for (let i = 0; i < INSTANCES; i++) procs[i].process(inputs, outputs, params[i]);
  }
  return (performance.now() - start) / quanta;
}

once(bundles[0]);
once(bundles[1]);
const before = [],
  after = [],
  ratios = [];
for (let r = 0; r < REPEATS; r++) {
  const first = r % 2;
  const t = [0, 0];
  t[first] = once(bundles[first]);
  t[1 - first] = once(bundles[1 - first]);
  before.push(t[0]);
  after.push(t[1]);
  ratios.push(t[1] / t[0]);
}
const median = (a) => [...a].sort((x, y) => x - y)[(a.length - 1) / 2];
console.log(
  JSON.stringify({
    factor,
    mode,
    repeats: REPEATS,
    beforeMs: +median(before).toFixed(3),
    afterMs: +median(after).toFixed(3),
    ratio: +median(ratios).toFixed(4),
    ratioMin: +Math.min(...ratios).toFixed(4),
    ratioMax: +Math.max(...ratios).toFixed(4),
  }),
);
