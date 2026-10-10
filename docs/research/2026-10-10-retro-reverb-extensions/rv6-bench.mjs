/* global URL, process, console */
// RV-6's per-quantum cost, linear against gain-ranging converter: `rv4-bench.mjs` with a converter
// argument in place of Size, at Character 1 and Mix 1. Offline in Node: complete worklet callbacks,
// warm JIT, no real-time load. It times the process's user CPU (`process.cpuUsage`) rather than
// the wall clock, so a busy machine that takes the core away between quanta does not count.
//
//   node rv6-bench.mjs [bundle.js] [linear|ranging]
import { readFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';

const root = new URL('../../../', import.meta.url);
const bundle =
  process.argv[2] ??
  new URL('packages/engine/src/worklet/generated/retro-reverb-processor.js', root);
const converter = process.argv[3] ?? 'linear';
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
params.character[0] = 1;
params.converter[0] = converter === 'ranging' ? 1 : 0;
// A sine falling 60 dB a second from 0.25, restarting every 2 s, so the ranging detector walks
// through every range and steps up and down.
const block = (q) =>
  Float32Array.from(
    { length: 128 },
    (_, i) => Math.sin((q * 128 + i) * 0.1) * 0.25 * 10 ** ((-3 * (((q * 128 + i) / 48000) % 2)) ),
  );
const blocks = Array.from({ length: 750 }, (_, q) => [[block(q)]]);
const output = [[new Float32Array(128), new Float32Array(128)]];
const parameterData = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]]));
const QUANTA = 375 * 4;
const scenarios = [];
for (const count of [1, 8, 16]) {
  const nodes = Array.from({ length: count }, () => new Processor({ parameterData }));
  const runs = [];
  for (let run = 0; run < 8; run++) {
    const start = process.cpuUsage().user;
    for (let q = 0; q < QUANTA; q++)
      for (const node of nodes) node.process(blocks[q % blocks.length], output, params);
    if (run > 1) runs.push((process.cpuUsage().user - start) / (QUANTA * count));
  }
  runs.sort((a, b) => a - b);
  scenarios.push({ instances: count, medianCpuMicrosecondsPerQuantum: runs[runs.length >> 1] });
}
console.log(
  JSON.stringify({
    machine: `${cpus()[0].model}, ${platform()} ${release()}, ${process.arch}`,
    backend: `Node ${process.version} / V8 ${process.versions.v8}`,
    converter,
    scenarios,
  }),
);
