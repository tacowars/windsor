/* global URL, process, console */
// RV-2's per-quantum cost: the 2026-09-24 bench (`../2026-09-24-682-retro-reverb/bench.mjs`)
// with today's bundle path, a bundle argument (so a copy of the old bundle can run too) and
// Drift settings. Offline in Node: complete worklet callbacks, warm JIT, no real-time load.
//
//   node rv2-bench.mjs [bundle.js] [driftDepth] [driftRate]
import { readFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';

const root = new URL('../../../', import.meta.url);
const bundle =
  process.argv[2] ??
  new URL('packages/engine/src/worklet/generated/retro-reverb-processor.js', root);
const depth = Number(process.argv[3] ?? 0);
const rate = Number(process.argv[4] ?? 0.5);
const source = readFileSync(bundle, 'utf8');
let Processor;
class Base {
  port = { onmessage: null, postMessage() {} };
}
new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source)(
  Base,
  48000,
  (_name, ctor) => {
    Processor = ctor;
  },
);
const params = Object.fromEntries(
  Processor.parameterDescriptors.map((d) => [d.name, new Float32Array([d.defaultValue])]),
);
params.mix[0] = 1;
params.driftDepth[0] = depth;
params.driftRate[0] = rate;
const input = [[Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.1) * 0.25)]];
const output = [[new Float32Array(128), new Float32Array(128)]];
const parameterData = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]]));
const QUANTA = 375 * 4;
const scenarios = [];
for (const count of [1, 8, 16]) {
  const nodes = Array.from({ length: count }, () => new Processor({ parameterData }));
  const runs = [];
  for (let run = 0; run < 8; run++) {
    const start = performance.now();
    for (let q = 0; q < QUANTA; q++) for (const node of nodes) node.process(input, output, params);
    if (run > 1) runs.push(((performance.now() - start) * 1000) / (QUANTA * count));
  }
  runs.sort((a, b) => a - b);
  scenarios.push({ instances: count, medianMicrosecondsPerQuantum: runs[runs.length >> 1] });
}
console.log(
  JSON.stringify({
    machine: `${cpus()[0].model}, ${platform()} ${release()}, ${process.arch}`,
    backend: `Node ${process.version} / V8 ${process.versions.v8}`,
    driftDepth: depth,
    driftRate: rate,
    scenarios,
  }),
);
