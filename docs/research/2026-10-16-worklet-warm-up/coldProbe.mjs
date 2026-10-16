/* global process, console, URL */
/** Which processors are cold at the first ▶, and for how long (windsor#837, decision 1).
 *   node docs/research/2026-10-16-worklet-warm-up/coldProbe.mjs [--rate 48000] [--label before]
 * One child Node a case, so each starts with a cold V8: it evaluates one shipped bundle from
 * `packages/engine/src/worklet/generated/` as the audio thread's scope does (timed: the
 * module's share of the build), constructs one processor (timed), renders `IDLE` quanta of
 * silence (the wait between the power button and ▶), then `PLAYED` quanta of signal: notes
 * for an FM part, noise for the rest. Each quantum's `process` is timed. The steady cost is
 * the median of the last `STEADY` quanta; the cold cost is what the first quanta of signal
 * took over it. Writes `results/<time>-probe-<label>.json` and prints a table.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const QUANTUM = 128;
const IDLE = 1000;
const PLAYED = 6000;
const STEADY = 2000;
const SETTLE_WINDOW = 32;
const SETTLE_RATIO = 1.25;
// `--bundles <dir>`: the generated bundles to run, by default the worktree's own (a copy of
// another commit's `generated/` gives its "before").
const shipped = new URL('../../../packages/engine/src/worklet/generated/', import.meta.url);
const bundlesAt = (dir) => (dir ? new URL(`file://${dir.replace(/\/?$/, '/')}`) : shipped);
const patches = new URL('../../../packages/engine/src/patches/', import.meta.url);
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};

const patch = (id) => JSON.parse(readFileSync(new URL(`${id}.json`, patches), 'utf8')).patch;
const fm = (id, line) => ({ name: `fm ${id}`, bundle: 'fm-processor.js', patch: id, line, inputs: 0 });
const insert = (name, bundle, inputs = 1, extra = {}) => ({ name, bundle, inputs, ...extra });

/** The cases: the FM part on drums and pads, every worklet insert, the plate, the output stage, the meter bank. */
export const CASES = [
  fm('tr909-kick', 'drum'),
  fm('tr909-hat-closed', 'drum'),
  fm('tr909-snare', 'drum'),
  fm('tr808-tom-mid', 'drum'),
  fm('pad-drift', 'pad'),
  insert('eq', 'eq-processor.js'),
  insert('compressor', 'compressor-processor.js', 2),
  insert('delay', 'delay-processor.js'),
  insert('filter', 'filter-processor.js'),
  insert('phaser', 'phaser-processor.js'),
  insert('tape', 'tape-processor.js'),
  insert('advanced-drive', 'advanced-drive-processor.js'),
  insert('retro-reverb', 'retro-reverb-processor.js'),
  insert('bloom', 'bloom-processor.js'),
  insert('pump', 'pump-processor.js', 2),
  insert('plate (reverb)', 'reverb-processor.js'),
  insert('output stage', 'output-stage-processor.js'),
  insert('part meter bank', 'peak-meter-processor.js', 16, { processor: 'windsor-part-meter-bank' }),
];

/* ------------------------------------------------------------------ the child */

function load(bundle, rate, processorName, dir) {
  const source = readFileSync(new URL(bundle, bundlesAt(dir)), 'utf8').replace(/\bcurrentFrame\b/g, 'currentFrame[0]');
  const wrapped = `(function (AudioWorkletProcessor, sampleRate, registerProcessor, currentFrame) {\n${source}\n})`;
  const frame = new Float64Array(1);
  let ctor;
  class Base {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
    }
  }
  const t0 = process.hrtime.bigint();
  vm.runInThisContext(wrapped, { filename: basename(bundle) })(
    Base,
    rate,
    (name, value) => {
      if (processorName === undefined || processorName === name) ctor = value;
    },
    frame,
  );
  const moduleMs = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ctor, frame, moduleMs };
}

function noise(channels, gain) {
  let s = 1;
  return Array.from({ length: channels }, () => {
    const channel = new Float32Array(QUANTUM);
    for (let i = 0; i < QUANTUM; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      channel[i] = gain * (s / 2 ** 32 - 0.5);
    }
    return channel;
  });
}

/** The notes due in quantum `q` of the played run: sixteenths for a drum, a held triad every bar for a pad, at 120 BPM. */
function notesIn(line, q, rate) {
  const from = q * QUANTUM;
  const to = from + QUANTUM;
  const step = line === 'drum' ? rate / 8 : rate * 2;
  const hold = line === 'drum' ? rate / 10 : rate * 2 - QUANTUM;
  const out = [];
  for (let k = Math.ceil(from / step); k * step < to; k++) {
    const at = Math.round(k * step);
    const notes = line === 'drum' ? [36 + (k % 3)] : [57 + (k % 2) * 2, 60 + (k % 2) * 2, 64 + (k % 2) * 2];
    notes.forEach((note, i) => {
      const id = k * 4 + i + 1;
      out.push({ type: 'noteOn', id, note, velocity: k % 4 === 0 ? 1 : 0.7, frame: at });
      out.push({ type: 'noteOff', id, note, frame: at + hold });
    });
  }
  return out;
}

/** `twin` quanta of signal through a throwaway processor of the same class, before the measured one is built: an ideal once-per-scope warm-up of that length. */
function warmTwin(config, ctor, frame, construct, rigs) {
  const t0 = process.hrtime.bigint();
  const twin = construct();
  for (let q = 0; q < config.twin; q++) {
    frame[0] = q * QUANTUM;
    if (config.line) for (const data of notesIn(config.line, q, config.rate)) twin.port.onmessage({ data });
    twin.process(config.line ? rigs.quietIn : rigs.loudIn, rigs.outputs, rigs.params);
  }
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

/**
 * A list as the Node harness builds one, a plain array: the shape the warm-up's scratch takes
 * where there is no `AudioWorkletGlobalScope` (`worklet/warmUp.ts`), so the probe measures the
 * render with the feedback a real scope leaves (Chrome's own lists are frozen and holey, and so
 * is the warm-up's scratch there).
 */
function hostList(n, item) {
  return Array.from({ length: n }, (_, i) => item(i));
}

function child(config) {
  const rate = config.rate;
  const { ctor, frame, moduleMs } = load(config.bundle, rate, config.processor, config.bundles);
  // The parameters as the harness builds them: one object, key by key in descriptor order.
  const params = {};
  for (const d of ctor.parameterDescriptors ?? []) params[d.name] = new Float32Array([d.defaultValue ?? 0]);
  const options = config.patch ? { maxVoices: 12, patch: patch(config.patch) } : undefined;
  const construct = () =>
    new ctor({
      processorOptions: options,
      numberOfInputs: config.inputs,
      parameterData: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]])),
    });
  const silence = new Float32Array(QUANTUM);
  const quietIn = hostList(config.inputs, () => hostList(2, () => silence));
  const loud = noise(2, 0.5);
  const loudIn = hostList(config.inputs, (i) => hostList(2, (c) => (i === 0 ? loud[c] : silence)));
  const outputs = hostList(1, () => hostList(2, () => new Float32Array(QUANTUM)));
  const twinMs = config.twin > 0 ? warmTwin(config, ctor, frame, construct, { quietIn, loudIn, outputs, params }) : 0;
  const t0 = process.hrtime.bigint();
  const processor = construct();
  const constructMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const times = new Float64Array(PLAYED);
  for (let q = 0; q < IDLE; q++) {
    frame[0] = q * QUANTUM;
    processor.process(quietIn, outputs, params);
  }
  let peak = 0;
  for (let q = 0; q < PLAYED; q++) {
    frame[0] = (IDLE + q) * QUANTUM;
    if (config.line) for (const data of notesIn(config.line, q, rate)) {
      data.frame += IDLE * QUANTUM;
      processor.port.onmessage({ data });
    }
    const s = process.hrtime.bigint();
    processor.process(config.line ? quietIn : loudIn, outputs, params);
    times[q] = Number(process.hrtime.bigint() - s) / 1e3;
    for (let i = 0; i < QUANTUM; i += 16) peak = Math.max(peak, Math.abs(outputs[0][0][i]));
  }
  return { moduleMs, constructMs, twinMs, times: Array.from(times), peak };
}

/* ------------------------------------------------------------------ the parent */

function summarise(times) {
  const steadySorted = times.slice(-STEADY).sort((a, b) => a - b);
  const steady = steadySorted[steadySorted.length >> 1];
  const excess = (n) => times.slice(0, n).reduce((s, t) => s + Math.max(0, t - steady), 0) / 1000;
  let settled = times.length;
  for (let q = 0; q + SETTLE_WINDOW <= times.length; q++) {
    const window = times.slice(q, q + SETTLE_WINDOW).sort((a, b) => a - b);
    if (window[SETTLE_WINDOW >> 1] <= steady * SETTLE_RATIO) {
      settled = q;
      break;
    }
  }
  return {
    steadyUs: steady,
    firstUs: times[0],
    worstUs: Math.max(...times.slice(0, 200)),
    excessMs10: excess(10),
    excessMs100: excess(100),
    excessMsAll: excess(times.length - STEADY),
    settledQuanta: settled,
  };
}

function parent() {
  const rate = Number(arg('--rate', 48000));
  const label = arg('--label', 'run');
  const only = arg('--only', null);
  // `--twin n`: the ideal warm-up's length in quanta (0, none: the cold start as shipped).
  const twin = Number(arg('--twin', 0));
  const self = fileURLToPath(import.meta.url);
  const rows = [];
  for (const c of CASES) {
    if (only && !c.name.includes(only)) continue;
    const config = JSON.stringify({ ...c, rate, twin, bundles: arg('--bundles', null), line: c.line ?? null });
    const run = spawnSync(process.execPath, [self, '--child', config], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (run.status !== 0) throw Error(`${c.name}: ${run.stderr}`);
    const r = JSON.parse(run.stdout);
    const row = { name: c.name, moduleMs: r.moduleMs, constructMs: r.constructMs, twinMs: r.twinMs, peak: r.peak, ...summarise(r.times) };
    rows.push(row);
    console.log(
      [
        c.name.padEnd(22),
        `module ${r.moduleMs.toFixed(1)} ms`,
        `construct ${r.constructMs.toFixed(2)} ms`,
        ...(twin ? [`twin ${r.twinMs.toFixed(1)} ms`] : []),
        `steady ${row.steadyUs.toFixed(1)} µs`,
        `first ${row.firstUs.toFixed(0)} µs`,
        `worst ${row.worstUs.toFixed(0)} µs`,
        `excess 10/100/all ${row.excessMs10.toFixed(2)}/${row.excessMs100.toFixed(2)}/${row.excessMsAll.toFixed(2)} ms`,
        `settled ${row.settledQuanta} q`,
        `peak ${row.peak.toFixed(2)}`,
      ].join('  '),
    );
  }
  const environment = {
    cpu: cpus()[0].model,
    node: process.version,
    v8: process.versions.v8,
    rate,
    twin,
    bundles: arg('--bundles', null) ? 'other' : 'worktree',
    label,
  };
  const folder = new URL('results/', import.meta.url);
  mkdirSync(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = new URL(`${stamp}-probe-${label}.json`, folder);
  writeFileSync(out, `${JSON.stringify({ environment, rows }, null, 2)}\n`);
  console.log('wrote', out.pathname);
}

if (process.argv[2] === '--child') process.stdout.write(JSON.stringify(child(JSON.parse(process.argv[3]))));
else parent();
