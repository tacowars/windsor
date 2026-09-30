/* global process, console */
/**
 * The Parametric EQ's measurements (windsor#198), run from the repository root:
 *
 *   node docs/research/2026-09-30-parametric-eq/bench.mjs
 *
 * 1. Accuracy: every band type's worst error against its analog prototype,
 *    matched (the shipped designs) and prewarped bilinear (the cookbook), from
 *    `packages/engine/src/__fixtures__/eqAccuracy.ts`, bundled here.
 * 2. Throughput: the shipped `generated/eq-processor.js`, run as the test
 *    harness runs it, in offline render quanta of 128 frames at 48 kHz.
 *
 * Writes `bench.json` beside this file and prints the README's tables.
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { performance } from 'node:perf_hooks';

const root = process.cwd();
const engine = `${root}/packages/engine/src`;
const here = `${root}/docs/research/2026-09-30-parametric-eq`;
const RATE = 48000;
const QUANTUM = 128;

async function load(path) {
  const result = await build({
    entryPoints: [path],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'esnext',
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}

// ---- 1. accuracy
const accuracy = await load(`${engine}/__fixtures__/eqAccuracy.ts`);
const { EQ_TYPE_ID } = await load(`${engine}/inserts/eqConstants.ts`);
const { ACCURACY_GRID: G, bandError } = accuracy;
const grid = G.rates.flatMap((rate) =>
  G.types.flatMap((type) =>
    G.centres.flatMap((centre) =>
      G.qs.flatMap((q) => G.gains.map((gain) => ({ rate, type, centre, q, gain }))),
    ),
  ),
);
// Cuts at 12 dB/oct (one section at the band's Q); gain is heard on the bell and shelves only.
const table = grid.map((row) => {
  const band = { type: EQ_TYPE_ID[row.type], slope: 12, freq: row.centre, gain: row.gain, q: row.q };
  const errors = {};
  for (const form of ['matched', 'bilinear'])
    for (const maxHz of [16000, 20000])
      errors[`${form}${maxHz / 1000}k`] = +bandError(band, row.rate, form, maxHz).toFixed(3);
  return { ...row, ...errors };
});

// ---- 2. throughput
const source = readFileSync(`${engine}/worklet/generated/eq-processor.js`, 'utf8');
/** One registered class per case, as a context holds one module; its instances share its code. */
function processorClass() {
  let Ctor;
  class Base {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
  }
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source)(
    Base,
    RATE,
    (_name, value) => {
      Ctor = value;
    },
  );
  return Ctor;
}
const Q = Math.SQRT1_2;
const TYPES = ['lowcut', 'lowshelf', 'bell', 'notch', 'highshelf', 'highcut'];
const SLOPES = [6, 12, 24, 48];
const band = (on, type, [freq, gain, q], slope = 12) => ({ on, type, freq, gain, q, slope });
const FLAT = [
  band(false, 'lowcut', [30, 0, Q]),
  band(true, 'lowshelf', [100, 0, Q]),
  band(true, 'bell', [250, 0, Q]),
  band(true, 'bell', [800, 0, Q]),
  band(true, 'bell', [2500, 0, Q]),
  band(true, 'bell', [6000, 0, Q]),
  band(true, 'highshelf', [10000, 0, Q]),
  band(false, 'highcut', [18000, 0, Q]),
];
const FOUR = FLAT.map((b, i) =>
  i === 0
    ? { ...b, on: true, freq: 80 }
    : i === 2
      ? { ...b, gain: -3, q: 1.4 }
      : i === 4
        ? { ...b, gain: 2.5, q: 0.9 }
        : i === 6
          ? { ...b, gain: 1.5 }
          : { ...b, on: false },
);
const EIGHT = [
  band(true, 'lowcut', [40, 0, Q], 48),
  band(true, 'lowshelf', [100, 2, Q]),
  band(true, 'bell', [250, -3, 1.4]),
  band(true, 'notch', [1240, 0, 8]),
  band(true, 'bell', [2500, 2.5, 0.9]),
  band(true, 'bell', [6000, -2, 2]),
  band(true, 'highshelf', [10000, 1.5, Q]),
  band(true, 'highcut', [16000, 0, Q], 48),
];
function params(descriptors, bands, extra = {}) {
  const values = { scale: 1, output: 0, enabled: 1, ...extra };
  bands.forEach((b, i) => {
    const n = `b${i + 1}`;
    Object.assign(values, {
      [`${n}Freq`]: b.freq,
      [`${n}Gain`]: b.gain,
      [`${n}Q`]: b.q,
      [`${n}Type`]: TYPES.indexOf(b.type),
      [`${n}Slope`]: SLOPES.indexOf(b.slope),
      [`${n}On`]: Number(b.on),
    });
  });
  return Object.fromEntries(descriptors.map((d) => [d.name, new Float32Array([values[d.name]])]));
}
const noise = [new Float32Array(QUANTUM * 64), new Float32Array(QUANTUM * 64)];
let seed = 1;
for (const channel of noise)
  for (let i = 0; i < channel.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    channel[i] = (seed / 2 ** 32 - 0.5) * 0.5;
  }
const silence = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];

/** Median microseconds per quantum over `rounds` of `quanta` quanta, after a warm-up of the same. */
function measure({ bands, extra, input = 'noise', moving = false, instances = 1 }) {
  const quanta = 20000;
  const rounds = 5;
  const Ctor = processorClass();
  const runs = Array.from({ length: instances }, () => {
    const instance = new Ctor({});
    const p = params(Ctor.parameterDescriptors, bands, extra);
    const knobs = bands.map((_, i) => p[`b${i + 1}Freq`]);
    return { instance, p, knobs, base: knobs.map((k) => k[0]) };
  });
  const out = [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]];
  const blocks = Array.from({ length: 64 }, (_, i) => [
    noise[0].subarray(i * QUANTUM, (i + 1) * QUANTUM),
    noise[1].subarray(i * QUANTUM, (i + 1) * QUANTUM),
  ]);
  const inputs = [null];
  const render = () => {
    for (let q = 0; q < quanta; q++) {
      inputs[0] = input === 'noise' ? blocks[q & 63] : silence;
      for (const run of runs) {
        if (moving)
          for (let b = 0; b < run.knobs.length; b++)
            // An octave's sweep up and back every 256 quanta (0.68 s): never settles.
            run.knobs[b][0] = run.base[b] * Math.pow(2, Math.abs(((q % 256) - 128) / 128));
        run.instance.process(inputs, out, run.p);
      }
    }
  };
  render();
  const times = [];
  for (let r = 0; r < rounds; r++) {
    const start = performance.now();
    render();
    times.push(((performance.now() - start) * 1000) / quanta);
  }
  times.sort((a, b) => a - b);
  return +times[rounds >> 1].toFixed(3);
}
const budget = (QUANTUM / RATE) * 1e6;
const cases = [
  ['flat (new EQ)', { bands: FLAT }],
  ['4 bands active', { bands: FOUR }],
  ['all 8 active, 48 dB cuts at both ends', { bands: EIGHT }],
  ['all 8 moving', { bands: EIGHT, moving: true }],
  ['all 8 active, silent input', { bands: EIGHT, input: 'silence' }],
  ['disabled (bypassed)', { bands: EIGHT, extra: { enabled: 0 } }],
  ['16 instances, 4 bands active each', { bands: FOUR, instances: 16 }],
];
const throughput = cases.map(([name, options]) => {
  const us = measure(options);
  return { case: name, usPerQuantum: us, percentOfQuantum: +((100 * us) / budget).toFixed(2) };
});

const environment = {
  date: new Date().toISOString().slice(0, 10),
  machine: `${cpus()[0].model}, Darwin ${release()}`,
  node: process.version,
  v8: process.versions.v8,
  backend: 'the shipped eq-processor.js bundle in Node, offline, no browser or audio device',
  sampleRate: RATE,
  quantum: QUANTUM,
};
writeFileSync(`${here}/bench.json`, `${JSON.stringify({ environment, throughput, accuracy: table }, null, 2)}\n`);

// ---- the README's tables
const worst = (rows, key) => Math.max(...rows.map((r) => r[key])).toFixed(2);
console.log(JSON.stringify(environment));
for (const rate of G.rates) {
  console.log(`\n${rate} Hz — worst |error| in dB up to 16 kHz (up to 20 kHz), matched / bilinear\n`);
  console.log(`| Type | ${G.centres.map((c) => `${c / 1000} kHz`).join(' | ')} |`);
  console.log(`| --- | ${G.centres.map(() => '---:').join(' | ')} |`);
  for (const type of G.types) {
    const cells = G.centres.map((centre) => {
      const rows = table.filter((r) => r.rate === rate && r.type === type && r.centre === centre);
      return `${worst(rows, 'matched16k')} / ${worst(rows, 'bilinear16k')} (${worst(rows, 'matched20k')} / ${worst(rows, 'bilinear20k')})`;
    });
    console.log(`| ${type} | ${cells.join(' | ')} |`);
  }
}
console.log('\n| Case | µs per quantum | % of a quantum |\n| --- | ---: | ---: |');
for (const row of throughput) console.log(`| ${row.case} | ${row.usPerQuantum} | ${row.percentOfQuantum} |`);
