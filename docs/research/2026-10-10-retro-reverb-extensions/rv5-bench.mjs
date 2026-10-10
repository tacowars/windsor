/* global URL, process, console */
// RV-5's per-quantum cost: `rv4-bench.mjs` with Low decay, Low cross and Density arguments in
// place of Size. Offline in Node: complete worklet callbacks, warm JIT, no real-time load. It
// times the process's user CPU (`process.cpuUsage`) rather than the wall clock, so a busy machine
// that takes the core away between quanta does not count.
//
//   node rv5-bench.mjs [bundle.js] [lowDecay] [density] [lowCross]
import { readFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';

const root = new URL('../../../', import.meta.url);
const bundle =
  process.argv[2] && process.argv[2] !== '-'
    ? process.argv[2]
    : new URL('packages/engine/src/worklet/generated/retro-reverb-processor.js', root);
const lowDecay = Number(process.argv[3] ?? 1);
const density = Number(process.argv[4] ?? 0);
const lowCross = Number(process.argv[5] ?? 300);
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
// A bundle from before RV-5 takes them (RV-0 declared them) and ignores them.
params.lowDecay[0] = lowDecay;
params.lowCross[0] = lowCross;
params.density[0] = density;
const input = [[Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.1) * 0.25)]];
const output = [[new Float32Array(128), new Float32Array(128)]];
const parameterData = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]]));
const QUANTA = 375 * 4;
const scenarios = [];
for (const count of [1, 8, 16]) {
  const nodes = Array.from({ length: count }, () => new Processor({ parameterData }));
  const runs = [];
  for (let run = 0; run < 8; run++) {
    const start = process.cpuUsage().user;
    for (let q = 0; q < QUANTA; q++) for (const node of nodes) node.process(input, output, params);
    if (run > 1) runs.push((process.cpuUsage().user - start) / (QUANTA * count));
  }
  runs.sort((a, b) => a - b);
  scenarios.push({ instances: count, medianCpuMicrosecondsPerQuantum: runs[runs.length >> 1] });
}
console.log(
  JSON.stringify({
    machine: `${cpus()[0].model}, ${platform()} ${release()}, ${process.arch}`,
    backend: `Node ${process.version} / V8 ${process.versions.v8}`,
    lowDecay,
    density,
    lowCross,
    scenarios,
  }),
);
