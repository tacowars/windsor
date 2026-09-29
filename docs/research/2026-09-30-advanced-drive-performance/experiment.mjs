/* global process, console */
/** Review-only source transforms; never writes production source or generated bundles. */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cpus, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, URL } from 'node:url';
const root = process.cwd();
const require = createRequire(root + '/package.json');
const { build } = require('esbuild');
const engine = root + '/packages/engine/src';
const output = fileURLToPath(new URL('.', import.meta.url));
const reviewCommit = '41f8084cd99d201817b6ddfcb5da6fd091a3e941';

function replace(source, before, after) {
  if (!source.includes(before)) throw Error('Missing replacement: ' + before);
  return source.replace(before, after);
}
function transform(source, path, flags) {
  if (flags.includes('smooth') && path.endsWith('/advancedDriveDsp.ts')) {
    source = replace(source, 'this.pending = false;\n    this.graph.configure', 'this.pending = false;\n    this.activeKeys = new Array(CONTINUOUS.length);\n    this.activeCount = 0;\n    this.graph.configure');
    source = replace(source, 'this.pending = false;\n    for (const key of DISCRETE)', 'this.activeCount = 0;\n    for (const key of CONTINUOUS)\n      if (this.targets[key] !== this.controls[key]) this.activeKeys[this.activeCount++] = key;\n    this.pending = false;\n    for (const key of DISCRETE)');
    source = replace(source, 'for (const key of CONTINUOUS) {', 'for (let i = 0; i < this.activeCount; i++) {\n      const key = this.activeKeys[i];');
  }
  if (flags.includes('cache') && path.endsWith('/advancedDriveFilter.ts')) {
    source = replace(source, 'this.b0 = 1;', 'this.lastType = "";\n    this.lastHz = this.lastQ = this.lastGain = this.lastRate = NaN;\n    this.b0 = 1;');
    source = replace(source, 'configure(o: DriveFilterOptions): void {', `configure(o: DriveFilterOptions): void {
    if (this.lastType === o.type && this.lastHz === o.hz && this.lastQ === o.q && this.lastGain === o.gain && this.lastRate === o.rate) return;
    this.lastType = o.type; this.lastHz = o.hz; this.lastQ = o.q; this.lastGain = o.gain; this.lastRate = o.rate;`);
  }
  if (flags.includes('cache') && path.endsWith('/driveTone.ts')) {
    source = replace(source, 'this.b0 = 1;', 'this.lastDb = this.lastHz = this.lastRate = NaN;\n    this.lastInverse = false;\n    this.b0 = 1;');
    source = replace(source, 'inverse = false): void {', `inverse = false): void {
    if (this.lastDb === db && this.lastHz === hz && this.lastRate === rate && this.lastInverse === inverse) return;
    this.lastDb = db; this.lastHz = hz; this.lastRate = rate; this.lastInverse = inverse;`);
  }
  if (flags.includes('decimate') && path.endsWith('/driveOversample.ts')) {
    source = replace(source, 'tick(x: number): number {', `advance(x: number): number {
    this.buffer[this.cursor] = x;
    if (++this.cursor === FIR.length) this.cursor = 0;
    return 0;
  }
  tick(x: number): number {`);
  }
  if (flags.includes('decimate') && path.endsWith('/advancedDriveDsp.ts')) {
    source = replace(source, 'this.down[0].tick(dryL + wet * (graph.left - dryL))', '(phase === 0 ? this.down[0].tick(dryL + wet * (graph.left - dryL)) : this.down[0].advance(dryL + wet * (graph.left - dryL)))');
    source = replace(source, 'this.down[1].tick(dryR + wet * (graph.right - dryR))', '(phase === 0 ? this.down[1].tick(dryR + wet * (graph.right - dryR)) : this.down[1].advance(dryR + wet * (graph.right - dryR)))');
  }
  return source;
}

async function compile(flags) {
  const result = await build({
    stdin: { contents: `export { AdvancedDriveDsp } from '${engine}/worklet/advancedDrive/advancedDriveDsp.ts';
      export { advancedDriveParameters } from '${engine}/inserts/advancedDriveParameters.ts';
      export { DEFAULT_ADVANCED_DRIVE } from '${engine}/inserts/advancedDriveSpec.ts';
      export { ADVANCED_DRIVE_PRESETS } from '${engine}/inserts/advancedDrivePresetTables.ts';`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'esnext', treeShaking: false,
    plugins: [{ name: 'review-only', setup(b) {
      b.onLoad({ filter: /\.ts$/ }, ({path}) => ({ contents: transform(execFileSync('git', ['show', `${reviewCommit}:${path.slice(root.length + 1)}`], {cwd: root, encoding: 'utf8'}), path, flags), loader: 'ts' }));
    }}],
  });
  const module = {exports: {}};
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}
const variants = {};
for (const [name, flags] of Object.entries({baseline: [], smooth: ['smooth'], cache: ['cache'], decimate: ['decimate'], combined: ['smooth', 'cache', 'decimate']})) variants[name] = await compile(flags);
const base = variants.baseline;
function params(spec) {
  return Object.fromEntries(Object.entries(base.advancedDriveParameters({...base.DEFAULT_ADVANCED_DRIVE, ...spec})).map(([k,v]) => [k, new Float32Array([v])]));
}
const signal = [new Float32Array(48000), new Float32Array(48000)];
for (let i = 0; i < signal[0].length; i++) {
  signal[0][i] = 0.3 * Math.sin(i * 0.057) + 0.1 * Math.sin(i * 0.37);
  signal[1][i] = 0.2 * Math.sin(i * 0.091) - 0.1 * Math.sin(i * 0.57);
}
function render(dsp, p, blocks) {
  for (let block = 0; block < blocks; block++) {
    dsp.configure(p, 128);
    for (let i = 0; i < 128; i++) {
      const frame = (block * 128 + i) % signal[0].length;
      dsp.tick(signal[0][frame], signal[1][frame]);
    }
  }
}
function editParameters(p, block) {
  const step = block / 20;
  p.route[0] = step % 5;
  p.wave[0] = step % 5;
  p.enabled[0] = step % 4 === 0 ? 0 : 1;
  p.mix[0] = step % 3 / 2;
  p.tone[0] = step % 2 ? 12 : -12;
  p.compensation[0] = step % 2;
  p.low[0] = step % 2 ? 40 : 4000;
  p.high[0] = step % 2 ? 200 : 16000;
  p.sync[0] = step % 2; p.bpm[0] = step % 2 ? 60 : 180;
  p.attack[0] = step % 2 ? 1 : 500; p.release[0] = step % 2 ? 10 : 2000;
  for (let s = 0; s < 3; s++) {
    p[`s${s}_shaper`][0] = (step + s) % 8;
    p[`s${s}_filter`][0] = (step + s) % 5;
    p[`s${s}_filtering`][0] = step % 2;
    p[`s${s}_enabled`][0] = (step + s) % 3 ? 1 : 0;
    p[`s${s}_shaping`][0] = step % 3 ? 1 : 0;
    p[`s${s}_pre`][0] = step % 2;
    p[`s${s}_amount`][0] = step % 2;
    p[`s${s}_bias`][0] = step % 2 ? -1 : 1;
    p[`s${s}_level`][0] = step % 2 ? -24 : 24;
    p[`s${s}_frequency`][0] = step % 2 ? 20 : 20000;
    p[`s${s}_resonance`][0] = step % 2 ? 0.5 : 12;
    p[`s${s}_peak`][0] = step % 2 ? -18 : 18;
    for (const mod of ['envAmount','lfoAmount','envBias','lfoBias']) p[`s${s}_${mod}`][0] = step % 2 ? -0.8 : 0.8;
    for (const mod of ['envCutoff','lfoCutoff']) p[`s${s}_${mod}`][0] = step % 2 ? -5 : 5;
  }
}
function compare({name, rate, spec, blocks, dynamic}) {
  const p = params(spec);
  const a = new base.AdvancedDriveDsp(rate, p), b = new variants[name].AdvancedDriveDsp(rate, p);
  for (let block = 0; block < blocks; block++) {
    if (dynamic && block < 800 && block % 20 === 0) editParameters(p, block);
    a.configure(p, 128); b.configure(p, 128);
    for (let i = 0; i < 128; i++) {
      const frame = (block * 128 + i) % signal[0].length;
      const silent = dynamic && block > 600 && block < 1400;
      const l = silent ? 0 : signal[0][frame], r = silent ? 0 : signal[1][frame];
      a.tick(l, r); b.tick(l, r);
      if (!Object.is(a.left, b.left) || !Object.is(a.right, b.right) || !Number.isFinite(a.left) || !Number.isFinite(a.right)) throw Error(`Mismatch ${name} ${rate} ${block} ${i}`);
    }
  }
  return blocks * 128 * 2;
}
const results = {environment: {cpu: cpus()[0]?.model, arch: process.arch, os: release(), node: process.version, v8: process.versions.v8, browser: 'none', backend: 'source-bundled DSP in Node; no audio device'}, parity: {}, benchmarks: []};
if (process.argv.includes('--parity')) {
  for (const name of ['smooth', 'cache', 'decimate', 'combined']) {
    let checked = 0;
    for (const rate of [44100, 48000, 96000]) {
      checked += compare({name, rate, spec: {}, blocks: 1600, dynamic: true});
      for (const preset of base.ADVANCED_DRIVE_PRESETS)
        checked += compare({name, rate, spec: preset.settings, blocks: 100, dynamic: false});
    }
    results.parity[name] = {identicalDoubleSamples: checked};
    console.log('parity', name, checked);
  }
} else {
  const blocks = 375;
  for (const preset of base.ADVANCED_DRIVE_PRESETS) {
    const p = params(preset.settings), dsps = {};
    for (const [name, api] of Object.entries(variants)) { dsps[name] = new api.AdvancedDriveDsp(48000, p); render(dsps[name], p, blocks); }
    const times = Object.fromEntries(Object.keys(variants).map(k => [k, []]));
    for (let repeat = 0; repeat < 5; repeat++) {
      const names = Object.keys(variants);
      if (repeat % 2) names.reverse();
      for (const name of names) {
        const start = performance.now(); render(dsps[name], p, blocks);
        times[name].push(performance.now() - start);
      }
    }
    const medians = Object.fromEntries(Object.entries(times).map(([k,v]) => [k, [...v].sort((a,b)=>a-b)[2]]));
    results.benchmarks.push({preset: preset.id, rate: 48000, frames: blocks * 128, warmupFrames: blocks * 128, timesMs: times, medianMs: medians});
    console.log(preset.id, medians);
  }
}
writeFileSync(output + (process.argv.includes('--parity') ? '/parity.json' : '/benchmark.json'), JSON.stringify(results, null, 2) + '\n');
