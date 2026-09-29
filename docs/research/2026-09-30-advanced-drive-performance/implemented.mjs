/* global process, console */
/** Measure the production source against the reviewed commit, without reading generated files. */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { URL } from 'node:url';

const root = process.cwd();
const baseline = '41f8084cd99d201817b6ddfcb5da6fd091a3e941';
const engine = root + '/packages/engine/src';
const frames = 48000;
const blockSize = 128;
const rounds = 5;

async function compile(original) {
  const result = await build({
    stdin: {
      contents: `export { AdvancedDriveDsp } from '${engine}/worklet/advancedDrive/advancedDriveDsp.ts';
        export { advancedDriveParameters } from '${engine}/inserts/advancedDriveParameters.ts';
        export { DEFAULT_ADVANCED_DRIVE } from '${engine}/inserts/advancedDriveSpec.ts';
        export { ADVANCED_DRIVE_PRESETS } from '${engine}/inserts/advancedDrivePresetTables.ts';`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'esnext', treeShaking: false,
    plugins: original ? [{name: 'original-source', setup(b) {
      b.onLoad({filter: /\.ts$/}, ({path}) => ({
        contents: execFileSync('git', ['show', `${baseline}:${path.slice(root.length + 1)}`], {cwd: root, encoding: 'utf8'}),
        loader: 'ts',
      }));
    }}] : [],
  });
  const module = {exports: {}};
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}
const apis = {baseline: await compile(true), implemented: await compile(false)};
const input = [new Float32Array(frames), new Float32Array(frames)];
for (let i = 0; i < frames; i++) {
  input[0][i] = 0.3 * Math.sin(i * 0.057) + 0.1 * Math.sin(i * 0.37);
  input[1][i] = 0.2 * Math.sin(i * 0.091) - 0.1 * Math.sin(i * 0.57);
}
function render(dsp, params) {
  for (let frame = 0; frame < frames; frame += blockSize) {
    dsp.configure(params, blockSize);
    for (let i = 0; i < blockSize; i++) dsp.tick(input[0][frame + i], input[1][frame + i]);
  }
}
function checkOutput(dsps, params) {
  let identicalDoubleSamples = 0;
  for (let frame = 0; frame < frames; frame += blockSize) {
    for (const dsp of Object.values(dsps)) dsp.configure(params, blockSize);
    for (let i = 0; i < blockSize; i++) {
      for (const dsp of Object.values(dsps)) dsp.tick(input[0][frame + i], input[1][frame + i]);
      for (const channel of ['left', 'right']) {
        if (!Object.is(dsps.baseline[channel], dsps.implemented[channel]) || !Number.isFinite(dsps.implemented[channel]))
          throw Error(`Output mismatch at ${frame + i}, ${channel}`);
        identicalDoubleSamples++;
      }
    }
  }
  return identicalDoubleSamples;
}
const results = {
  baseline,
  environment: {cpu: cpus()[0]?.model, arch: process.arch, os: release(), node: process.version, v8: process.versions.v8, browser: 'none', backend: 'source-bundled DSP in Node; no audio device'},
  rate: 48000, frames, warmupFrames: frames, rounds, benchmarks: [],
};
for (const preset of apis.baseline.ADVANCED_DRIVE_PRESETS) {
  const spec = {...apis.baseline.DEFAULT_ADVANCED_DRIVE, ...preset.settings};
  const params = Object.fromEntries(Object.entries(apis.baseline.advancedDriveParameters(spec)).map(([k,v]) => [k, new Float32Array([v])]));
  const dsps = Object.fromEntries(Object.entries(apis).map(([name, api]) => [name, new api.AdvancedDriveDsp(results.rate, params)]));
  const identicalDoubleSamples = checkOutput(dsps, params);
  for (const dsp of Object.values(dsps)) render(dsp, params);
  const timesMs = {baseline: [], implemented: []};
  for (let round = 0; round < rounds; round++) {
    const names = round % 2 ? ['implemented', 'baseline'] : ['baseline', 'implemented'];
    for (const name of names) {
      const start = performance.now();
      render(dsps[name], params);
      timesMs[name].push(performance.now() - start);
    }
  }
  const medianMs = Object.fromEntries(Object.entries(timesMs).map(([name, values]) => [name, [...values].sort((a,b) => a-b)[Math.floor(rounds / 2)]]));
  results.benchmarks.push({preset: preset.id, identicalDoubleSamples, timesMs, medianMs});
  console.log(preset.id, medianMs);
}
writeFileSync(new URL('./implemented.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
