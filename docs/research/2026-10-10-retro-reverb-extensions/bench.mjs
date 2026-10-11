/* global URL, process */
// Retro Reverb's per-quantum cost: the generated `retro-reverb-processor.js` (or any copy of
// it), driven offline in Node through complete worklet callbacks on a warm JIT. It replaces
// RV-2..RV-6's `rv<n>-bench.mjs` copies, which grew from the 2026-09-24 bench
// (`../2026-09-24-682-retro-reverb/bench.mjs`). No real-time load, no browser.
//
//   node bench.mjs [--bundle <path>] [--set name=value,…]… [--preset rv2|rv3|rv4|rv5|rv6]
//                  [--input sine|falling] [--rate 48000] [--instances 1,8,16]
//                  [--rounds 1] [--out <file>]
//
// Each `--set` is one case, on top of Mix 1 and the bundle's defaults. Names are the
// processor's parameters (`decay`, `density`, `size`, `lowDecay`, …); `mode` also takes
// reverb|gated|reverse and `converter` linear|ranging. A name the bundle lacks is reported
// under `ignored`, so an older bundle runs the same command. `--preset` adds the cases an RV
// write-up measured. Each case runs in a Node process of its own (sharing one process, the
// cases' JIT feedback blurred their costs together), the cases interleaved, `--rounds` times.
// A reading is the median of six timed passes of four seconds of quanta, after two warm-up
// passes, in wall time and in that process's CPU time (`process.cpuUsage`: user + system as
// `cpu`, and user alone as `cpuUser`, which is what RV-4..RV-6 read).
// CPU time counts every thread, V8's background compiler too, so the first instance count a
// process measures can read above its wall time.
// JSON goes to stdout, or to `--out`; nothing is written into the repo by default.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, platform, release } from 'node:os';
import { relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const DEFAULT_BUNDLE = 'packages/engine/src/worklet/generated/retro-reverb-processor.js';
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FRAMES = 128;
const PASSES = 8;
const WARMUP_PASSES = 2;
const SECONDS_PER_PASS = 4;
const PRESETS = {
  rv2: { cases: ['driftDepth=0', 'driftDepth=1,driftRate=0.5', 'driftDepth=1,driftRate=5'] },
  rv3: {
    cases: ['density=0', 'density=0.5', 'density=1', 'driftDepth=1', 'density=1,driftDepth=1'],
  },
  rv4: { cases: ['size=1', 'size=3', 'size=10'] },
  rv5: {
    cases: [
      'lowDecay=1',
      'lowDecay=4',
      'density=1',
      'lowDecay=1,density=1',
      'lowDecay=4,density=1',
    ],
  },
  rv6: {
    input: 'falling',
    cases: ['character=1,converter=linear', 'character=1,converter=ranging'],
  },
};
const NAMED_VALUES = {
  mode: { reverb: 0, gated: 1, reverse: 2 },
  converter: { linear: 0, ranging: 1 },
};

function parseArgs(argv) {
  const options = { sets: [], input: 'sine', rate: 48000, instances: [1, 8, 16], rounds: 1 };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--bundle') options.bundle = value;
    else if (flag === '--set') options.sets.push(value);
    else if (flag === '--preset') {
      const preset = PRESETS[value];
      if (!preset) throw new Error(`unknown preset ${value}: ${Object.keys(PRESETS).join(', ')}`);
      options.sets.push(...preset.cases);
      options.input = preset.input ?? options.input;
    } else if (flag === '--input') options.input = value;
    else if (flag === '--rate') options.rate = Number(value);
    else if (flag === '--instances') options.instances = value.split(',').map(Number);
    else if (flag === '--rounds') options.rounds = Number(value);
    else if (flag === '--out') options.out = value;
    else if (flag === '--child') options.child = true;
    else throw new Error(`unknown option ${flag}`);
  }
  if (options.sets.length === 0) options.sets.push('');
  options.bundle = resolve(
    options.bundle ?? fileURLToPath(new URL(`../../../${DEFAULT_BUNDLE}`, import.meta.url)),
  );
  return options;
}

function loadProcessor(bundle, rate) {
  let Processor;
  class Base {
    port = { onmessage: null, postMessage() {} };
  }
  const source = readFileSync(bundle, 'utf8');
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source)(
    Base,
    rate,
    (_name, ctor) => {
      Processor = ctor;
    },
  );
  return Processor;
}

/** One case's parameter arrays: the bundle's defaults, Mix 1, then `name=value,…`. */
function caseParams(Processor, set) {
  const params = Object.fromEntries(
    Processor.parameterDescriptors.map((d) => [d.name, new Float32Array([d.defaultValue])]),
  );
  params.mix[0] = 1;
  const settings = {};
  const ignored = [];
  for (const pair of set.split(',').filter(Boolean)) {
    const [name, raw] = pair.split('=');
    const value = NAMED_VALUES[name]?.[raw] ?? Number(raw);
    if (Number.isNaN(value)) throw new Error(`bad value in ${pair}`);
    if (params[name]) params[name][0] = value;
    else ignored.push(name);
    settings[name] = raw;
  }
  return { params, settings, ignored };
}

/**
 * The input blocks: a steady 0.25 sine (RV-2..RV-5), or that sine falling 60 dB a second and
 * restarting every 2 s, so the gain-ranging converter walks every range (RV-6).
 */
function inputBlocks(kind, rate) {
  const count = kind === 'falling' ? Math.ceil((2 * rate) / FRAMES) : 1;
  const gain = (n) => (kind === 'falling' ? 10 ** (-3 * ((n / rate) % 2)) : 1);
  return Array.from({ length: count }, (_, q) => [
    [
      Float32Array.from({ length: FRAMES }, (_, i) => {
        const n = q * FRAMES + i;
        return Math.sin((kind === 'falling' ? n : i) * 0.1) * 0.25 * gain(n);
      }),
    ],
  ]);
}

/** Bytes in the typed arrays reachable from `value` (the instance's delay lines and state). */
function typedBytes(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return Object.values(value).reduce((total, v) => total + typedBytes(v, seen), 0);
}

const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
const round2 = (value) => Number(value.toFixed(2));

/** Median µs per quantum per instance over the timed passes: wall, CPU, user CPU. */
function measure({ Processor, params, blocks, count, quanta }) {
  const parameterData = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]]));
  const nodes = Array.from({ length: count }, () => new Processor({ parameterData }));
  const output = [[new Float32Array(FRAMES), new Float32Array(FRAMES)]];
  const wall = [];
  const cpu = [];
  const user = [];
  for (let pass = 0; pass < PASSES; pass++) {
    const start = performance.now();
    const cpuStart = process.cpuUsage();
    for (let q = 0; q < quanta; q++)
      for (const node of nodes) node.process(blocks[q % blocks.length], output, params);
    const used = process.cpuUsage(cpuStart);
    if (pass < WARMUP_PASSES) continue;
    const scale = quanta * count;
    wall.push(((performance.now() - start) * 1000) / scale);
    cpu.push((used.user + used.system) / scale);
    user.push(used.user / scale);
  }
  return { wall: median(wall), cpu: median(cpu), cpuUser: median(user) };
}

/** One case in this process, fresh from load: what a child prints for its parent. */
function runCase(options) {
  const Processor = loadProcessor(options.bundle, options.rate);
  const blocks = inputBlocks(options.input, options.rate);
  const quanta = Math.round((SECONDS_PER_PASS * options.rate) / FRAMES);
  const { params, settings, ignored } = caseParams(Processor, options.sets[0]);
  const parameterData = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]]));
  return {
    settings,
    ignored,
    bytesPerInstance: typedBytes(new Processor({ parameterData }).dsp),
    scenarios: options.instances.map((count) =>
      measure({ Processor, params, blocks, count, quanta }),
    ),
  };
}

/**
 * Every case in a process of its own, so one case's JIT feedback never shapes another's code,
 * interleaved round by round.
 */
function run(options) {
  const shared = ['--bundle', options.bundle, '--rate', String(options.rate)];
  shared.push('--instances', options.instances.join(','), '--input', options.input);
  const script = fileURLToPath(import.meta.url);
  const rounds = options.sets.map(() => []);
  for (let round = 0; round < options.rounds; round++)
    options.sets.forEach((set, index) => {
      const args = [script, ...shared, '--set', set, '--child', '1'];
      rounds[index].push(JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' })));
    });
  return {
    machine: `${cpus()[0].model}, ${platform()} ${release()}, ${process.arch}`,
    backend: `Node ${process.version} / V8 ${process.versions.v8}`,
    loadAverage: loadavg().map(round2),
    bundle: options.bundle.startsWith(REPO_ROOT)
      ? relative(REPO_ROOT, options.bundle)
      : options.bundle,
    sampleRate: options.rate,
    input: options.input,
    unit: `µs per ${FRAMES}-frame quantum per instance, median of ${options.rounds} round(s)`,
    cases: rounds.map((caseRounds) => summarise(caseRounds, options.instances)),
  };
}

function summarise(caseRounds, instances) {
  const { settings, ignored, bytesPerInstance } = caseRounds[0];
  const pick = (index, key) => caseRounds.map((round) => round.scenarios[index][key]);
  return {
    settings,
    ...(ignored.length ? { ignored } : {}),
    bytesPerInstance,
    scenarios: instances.map((count, index) => ({
      instances: count,
      wall: round2(median(pick(index, 'wall'))),
      cpu: round2(median(pick(index, 'cpu'))),
      cpuUser: round2(median(pick(index, 'cpuUser'))),
      ...(caseRounds.length > 1
        ? {
            cpuRange: [
              round2(Math.min(...pick(index, 'cpu'))),
              round2(Math.max(...pick(index, 'cpu'))),
            ],
          }
        : {}),
    })),
  };
}

const options = parseArgs(process.argv.slice(2));
if (options.child) {
  process.stdout.write(JSON.stringify(runCase(options)));
} else {
  const json = JSON.stringify(run(options), null, 2) + '\n';
  if (options.out) writeFileSync(options.out, json);
  else process.stdout.write(json);
}
