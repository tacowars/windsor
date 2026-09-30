/* global process, console */
/**
 * What the Parametric EQ allocates at a type, slope or on change when the code
 * that runs it has not been optimised yet (windsor#198), run from the
 * repository root:
 *
 *   node --expose-gc --min-semi-space-size=64 --max-semi-space-size=64 \
 *     docs/research/2026-09-30-parametric-eq/coldSwitch.mjs [bundle]
 *
 * A fresh processor plays noise through eight audible bands for 20 000 quanta
 * with nothing changing, then takes sixteen single changes, one band's type,
 * slope or on in turn, each followed by 1 000 quanta, and prints the heap's
 * growth after each (the reading's own ~600 bytes taken off). Then a second
 * fresh bundle does the same after toggling all eight bands every 8 quanta
 * for 48 000 quanta first, the state `eqAllocation.test.ts` measures.
 * `bundle` defaults to the shipped `generated/eq-processor.js`; pass another
 * build to compare.
 */
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';

const bundle =
  process.argv[2] ?? `${process.cwd()}/packages/engine/src/worklet/generated/eq-processor.js`;
const QUANTUM = 128;
const READING = 600;

function rig() {
  let ctor;
  class Base {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
  }
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', readFileSync(bundle, 'utf8'))(
    Base,
    48000,
    (_name, value) => (ctor = value),
  );
  const processor = new ctor();
  const params = { scale: new Float32Array([1]), output: new Float32Array([0]), enabled: new Float32Array([1]) };
  const field = { Type: [], Slope: [], On: [] };
  for (let b = 1; b <= 8; b++) {
    const values = { Freq: 100 * b + 37.3, Gain: 6.5, Q: 1.3, Type: b % 6, Slope: 2, On: 1 };
    for (const [name, value] of Object.entries(values)) params[`b${b}${name}`] = new Float32Array([value]);
    for (const name of Object.keys(field)) field[name].push(params[`b${b}${name}`]);
  }
  const left = new Float32Array(QUANTUM);
  const right = new Float32Array(QUANTUM);
  let s = 1;
  for (let i = 0; i < QUANTUM; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    left[i] = s / 2 ** 32 - 0.5;
    right[i] = -left[i];
  }
  const inputs = [[left, right]];
  const outputs = [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]];
  const change = (band, kind) => {
    const [a, n] = [
      [field.Type, 6],
      [field.Slope, 4],
      [field.On, 2],
    ][kind];
    a[band][0] = kind === 2 ? 1 - a[band][0] : (a[band][0] + 1) % n;
  };
  const run = (quanta, toggleEvery = 0) => {
    for (let q = 0; q < quanta; q++) {
      if (toggleEvery && q % toggleEvery === 0)
        for (let b = 0; b < 8; b++) change(b, (q / toggleEvery) % 3);
      processor.process(inputs, outputs, params);
    }
  };
  return { change, run };
}

function clicks(warm) {
  const { change, run } = rig();
  if (warm) run(48000, 8);
  run(20000);
  globalThis.gc();
  globalThis.gc();
  v8.getHeapStatistics();
  const bytes = [];
  for (let c = 0; c < 16; c++) {
    const before = v8.getHeapStatistics().used_heap_size;
    change(c % 8, c % 3);
    run(1000);
    bytes.push(v8.getHeapStatistics().used_heap_size - before - READING);
  }
  return bytes;
}

console.log(`bundle: ${bundle}`);
console.log(`cold: ${clicks(false).join(' ')}`);
console.log(`after the switch paths have run: ${clicks(true).join(' ')}`);
