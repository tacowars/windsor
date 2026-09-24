/* global URL, process, console */
// Run from any cwd with Node 24. Complete shipped worklet callback throughput,
// offline in Node: NOT real-time Chrome load, audio dropouts or target-machine evidence.
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

const root = new URL('../../../', import.meta.url);
const source = readFileSync(new URL('packages/client/src/audio/worklet/generated/phaser-processor.js', root), 'utf8');
let Processor;
class Base { port = { onmessage: null, postMessage() {} }; }
new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source)(Base, 48000, (_name, ctor) => { Processor = ctor; });
const params = Object.fromEntries(Processor.parameterDescriptors.map(d => [d.name, new Float32Array([d.defaultValue])]));
params.mix[0] = 1;
const input = [[Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.1) * 0.25)]];
const output = [[new Float32Array(128), new Float32Array(128)]];
function renderSecond(nodes) {
  for (let block = 0; block < 375; block++)
    for (const node of nodes) node.process(input, output, params);
}
const scenarios = [];
for (const [name, feedback, envelope, stereo] of [['classic', 0.25, 0, 0], ['acid', 0.65, 1.8, 20], ['space', 0.45, 0, 120]]) {
  params.feedback[0] = feedback; params.envelope[0] = envelope; params.stereo[0] = stereo;
  const parameterData = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, value[0]]));
  for (const count of [1, 8, 16]) {
    const nodes = Array.from({ length: count }, () => new Processor({ parameterData }));
    const measurements = [];
    let checksum = 0;
    for (let run = 0; run < 4; run++) {
      const start = performance.now();
      renderSecond(nodes);
      const elapsed = performance.now() - start;
      if (run) measurements.push(elapsed);
      checksum += output[0][0][127];
    }
    scenarios.push({ mode: name, instances: count, msPerAudioSecond: measurements, checksum });
  }
}
const result = {
  machine: { cpu: cpus()[0].model, os: `Darwin ${release()}`, arch: process.arch },
  backend: `Node ${process.version} / V8 ${process.versions.v8}; no graphics backend`,
  baseline: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sampleRate: 48000, blockFrames: 128, warmupSeconds: 1, scenarios,
  limitations: 'Sequential offline callbacks, warm JIT, no other game work. Includes stereo lattice filters, per-sample modulation and smoothing. No real-time scheduling, browser copy overhead, underrun verdict or target-machine claim.',
};
writeFileSync(new URL('./throughput.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
