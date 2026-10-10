/* global URL, process, console */
// RV-4's per-quantum cost and memory at a Size: `rv2-bench.mjs` with a Size argument, and the
// bytes of the typed arrays one instance holds. Offline in Node: complete worklet callbacks,
// warm JIT, no real-time load. It times the process's user CPU (`process.cpuUsage`) rather than
// the wall clock, so a busy machine that takes the core away between quanta does not count.
//
//   node rv4-bench.mjs [bundle.js] [size]
import { readFileSync } from 'node:fs';
import { cpus, release } from 'node:os';

const root = new URL('../../../', import.meta.url);
const bundle =
  process.argv[2] ??
  new URL('packages/engine/src/worklet/generated/retro-reverb-processor.js', root);
const size = Number(process.argv[3] ?? 1);
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
params.size[0] = size;
const input = [[Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.1) * 0.25)]];
const output = [[new Float32Array(128), new Float32Array(128)]];
const parameterData = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]]));
const QUANTA = 375 * 4;
/** Bytes in the typed arrays reachable from `value` (the instance's delay lines and state). */
function typedBytes(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return Object.values(value).reduce((total, v) => total + typedBytes(v, seen), 0);
}
const bytesPerInstance = typedBytes(new Processor({ parameterData }).dsp);
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
    machine: `${cpus()[0].model}, Darwin ${release()}, ${process.arch}`,
    backend: `Node ${process.version} / V8 ${process.versions.v8}`,
    size,
    bytesPerInstance,
    scenarios,
  }),
);
