/* global URL, process, console */
// RV-3's per-quantum cost: `rv2-bench.mjs` with a Density argument in place of Drift's rate,
// timed in this process's CPU time (user + system) as well as wall time, since a busy machine
// stretches the wall time of a process it deschedules. Offline in Node: complete worklet
// callbacks, warm JIT, no real-time load.
//
//   node rv3-bench.mjs [bundle.js] [density] [driftDepth]
import { readFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';

const root = new URL('../../../', import.meta.url);
const bundle =
  process.argv[2] ??
  new URL('packages/engine/src/worklet/generated/retro-reverb-processor.js', root);
const density = Number(process.argv[3] ?? 0);
const depth = Number(process.argv[4] ?? 0);
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
// A bundle from before Density has no such parameter.
if (params.density) params.density[0] = density;
const input = [[Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.1) * 0.25)]];
const output = [[new Float32Array(128), new Float32Array(128)]];
const parameterData = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]]));
const QUANTA = 375 * 4;
const scenarios = [];
for (const count of [1, 8, 16]) {
  const nodes = Array.from({ length: count }, () => new Processor({ parameterData }));
  const runs = [];
  const cpuRuns = [];
  for (let run = 0; run < 8; run++) {
    const start = performance.now();
    const cpu = process.cpuUsage();
    for (let q = 0; q < QUANTA; q++) for (const node of nodes) node.process(input, output, params);
    const used = process.cpuUsage(cpu);
    if (run > 1) {
      runs.push(((performance.now() - start) * 1000) / (QUANTA * count));
      cpuRuns.push((used.user + used.system) / (QUANTA * count));
    }
  }
  runs.sort((a, b) => a - b);
  cpuRuns.sort((a, b) => a - b);
  scenarios.push({
    instances: count,
    medianMicrosecondsPerQuantum: runs[runs.length >> 1],
    medianCpuMicrosecondsPerQuantum: cpuRuns[cpuRuns.length >> 1],
  });
}
console.log(
  JSON.stringify({
    machine: `${cpus()[0].model}, ${platform()} ${release()}, ${process.arch}`,
    backend: `Node ${process.version} / V8 ${process.versions.v8}`,
    density,
    driftDepth: depth,
    scenarios,
  }),
);
