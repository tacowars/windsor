/* global process, console */
/** Run from the repo root. Compare source, never inspect generated worklets. */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { URL } from 'node:url';

const root = process.cwd();
const baseline = 'c5e604af996d7f5c1e3713195a182da13e49c46b';
const frames = 48000 * 4, blockSize = 128, rounds = 7;
async function compile(original) {
  const result = await build({
    stdin: {
      contents: `export { TapeDsp } from './packages/engine/src/worklet/tape/tapeDsp.ts';
        export { TAPE_DEFAULTS } from './packages/engine/src/inserts/tapeConstants.ts';`,
      resolveDir: root, loader: 'ts',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'esnext', treeShaking: false,
    plugins: original ? [{ name: 'baseline-source', setup(b) {
      b.onLoad({ filter: /\.ts$/ }, ({ path }) => ({
        contents: execFileSync('git', ['show', `${baseline}:${path.slice(root.length + 1)}`], { encoding: 'utf8' }), loader: 'ts',
      }));
    } }] : [],
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}
const apis = { baseline: await compile(true), expanded: await compile(false) };
const input = [new Float32Array(frames), new Float32Array(frames)];
for (let i = 0; i < frames; i++) {
  input[0][i] = 0.3 * Math.sin(i * 0.057) + 0.1 * Math.sin(i * 0.37);
  input[1][i] = 0.2 * Math.sin(i * 0.091) - 0.1 * Math.sin(i * 0.57);
}
function params(api, values) {
  return Object.fromEntries(Object.entries({ ...api.TAPE_DEFAULTS, model: 0, ...values })
    .map(([key, value]) => [key, new Float32Array([Number(value)])]));
}
function render(dsp, p, moving) {
  for (let frame = 0; frame < frames; frame += blockSize) {
    if (moving) {
      p.drive[0] = 12 * Math.sin(frame / 8000);
      p.bias[0] = 40 * Math.sin(frame / 12000);
      p.model[0] = Math.floor(frame / 6000) % 3;
    }
    dsp.configure(p, blockSize);
    for (let i = 0; i < blockSize; i++) dsp.tick(input[0][frame + i], input[1][frame + i]);
  }
}
function parity(values, rate) {
  const p = Object.fromEntries(Object.entries(apis).map(([name, api]) => [name, params(api, values)]));
  const d = Object.fromEntries(Object.entries(apis).map(([name, api]) => [name, new api.TapeDsp(rate, p[name])]));
  let identicalFloat32Samples = 0;
  for (let frame = 0; frame < frames; frame += blockSize) {
    for (const name of Object.keys(d)) d[name].configure(p[name], blockSize);
    for (let i = 0; i < blockSize; i++) {
      for (const dsp of Object.values(d)) dsp.tick(input[0][frame + i], input[1][frame + i]);
      for (const channel of ['left', 'right']) {
        const actual = Math.fround(d.expanded[channel]);
        if (!Number.isFinite(actual) || !Object.is(actual, Math.fround(d.baseline[channel])))
          throw Error(`Legacy mismatch: ${JSON.stringify(values)}, ${rate}, ${frame + i}, ${channel}`);
        identicalFloat32Samples++;
      }
    }
  }
  return { values, rate, identicalFloat32Samples };
}
const results = {
  baseline,
  environment: { cpu: cpus()[0]?.model, arch: process.arch, os: release(), node: process.version, v8: process.versions.v8, browser: 'none', backend: 'source-bundled stereo DSP in Node; no audio device' },
  rate: 48000, frames, blockSize, warmupFrames: frames, rounds, parity: [], benchmarks: [],
};
for (const rate of [44100, 48000, 96000])
  for (const model of [0, 1, 2])
    for (const wear of [0, 63])
      results.parity.push(parity({ model, wear, drive: 8, hiss: -45, bias: -12, seed: 123 }, rate));
for (const scenario of [
  { name: 'legacy-studio', values: { model: 0, drive: 8, wear: 0, hiss: -70 } },
  { name: 'legacy-cassette-worn', values: { model: 1, drive: 8, wear: 63, hiss: -45 } },
  { name: 'legacy-moving-controls', values: { model: 0, wear: 63, hiss: -45 }, moving: true },
  { name: 'expanded-vhs', values: { model: 6, split: true, wow: 28, flutter: 14, dropouts: 22, wowRate: 0.6, flutterRate: 9, drive: 6, hiss: -48 }, expandedOnly: true },
]) {
  const names = scenario.expandedOnly ? ['expanded'] : ['baseline', 'expanded'];
  const p = Object.fromEntries(names.map((name) => [name, params(apis[name], scenario.values)]));
  const d = Object.fromEntries(names.map((name) => [name, new apis[name].TapeDsp(results.rate, p[name])]));
  const timesMs = Object.fromEntries(names.map((name) => [name, []]));
  for (const name of names) render(d[name], p[name], scenario.moving);
  for (let round = 0; round < rounds; round++) {
    for (const name of round % 2 ? [...names].reverse() : names) {
      const start = performance.now();
      render(d[name], p[name], scenario.moving);
      timesMs[name].push(performance.now() - start);
    }
  }
  const medianMs = Object.fromEntries(names.map((name) => [name, [...timesMs[name]].sort((a, b) => a - b)[Math.floor(rounds / 2)]]));
  results.benchmarks.push({ ...scenario, timesMs, medianMs });
  console.log(scenario.name, medianMs);
}
writeFileSync(new URL('./measurement.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
