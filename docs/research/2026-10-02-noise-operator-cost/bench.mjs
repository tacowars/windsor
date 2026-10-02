/* global process, structuredClone */
/**
 * Where a Noise operator's time goes (windsor#382), in the FM bundle, under
 * Node. Research only.
 *
 *   node bench.mjs <repo> <name>=<fm-processor.js> [<name>=<bundle> …]
 *                  [--rounds 40] [--seconds 10] [--only <scenario>] [--generic 0]
 *
 * Each bundle is evaluated once, the way `scripts/sound-match/render.mjs`
 * and `__fixtures__/workletHarness.ts` do it (a stand-in
 * `AudioWorkletProcessor`, 128-frame blocks at 48 kHz, seed 1, one note-on
 * at frame 0, no note-off), so this is windsor#380's method
 * (`docs/research/2026-10-01-tom-noise-colour-prototype/bench.mjs`): wall
 * time around one note's render, in ns per output sample of the one voice,
 * rounds interleaved with their order rotated, two warm-up rounds, the
 * median over rounds. Each scenario also runs with `specialise: false`
 * (every voice on the generic loop), and the bench reports whether the
 * sounding voice took the fixed-index kernel. `--only` runs one scenario, so
 * each can have a process (and V8's type feedback) of its own; the README's
 * tables ran every scenario that way. `--generic 0` skips the
 * `specialise: false` runs, for a CPU profile of the live path alone.
 *
 * Scenarios, every envelope held at its peak (attack 0, sustain 1) so no
 * operator sleeps and the voice never goes dormant:
 *   - `noise380`: windsor#380's lone Noise carrier exactly: `tr909-tom-mid`
 *     on algorithm 7 (A|B|C|D), C a Noise operator at level 1, A, B and D at
 *     level 0, the voice filter off. D keeps the tom's Noise wave at level 0.
 *   - `noise1`: the same with D a sine, so C is the only Noise operator.
 *   - `sine1`: the same with C a sine too: a lone sine carrier.
 *   - `tom`: `tr909-tom-mid` held, algorithm 6 (D>C | B | A), its Noise
 *     operator D a modulator into the sine carrier C.
 *   - `tomC`: the same with C switched to Noise (C and D both Noise).
 *   - `snare7`: algorithm 7 with two Noise carriers at level 0.5 (C and D)
 *     and two sines, a snare's shape.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const SR = 48000;
const BLOCK = 128;
const WARMUP_ROUNDS = 2;
const NOISE = 4;
const SINE = 0;
const FILTER_OFF = 0;
const OP_C = 2;

function parseArgs(argv) {
  const options = { rounds: 40, seconds: 10, only: null, generic: 1 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') options.only = argv[++i];
    else if (argv[i].startsWith('--')) options[argv[i].slice(2)] = Number(argv[++i]);
    else positional.push(argv[i]);
  }
  if (positional.length < 2) {
    process.stderr.write('usage: node bench.mjs <repo> <name>=<fm-processor.js> […]\n');
    process.exit(2);
  }
  const bundles = positional.slice(1).map((arg) => {
    const at = arg.indexOf('=');
    return { name: arg.slice(0, at), path: arg.slice(at + 1) };
  });
  return { options, repo: positional[0], bundles };
}

/** The processor class from one bundle's text, as `render.mjs` loads it. */
function loadProcessor(path) {
  const bundle = readFileSync(path, 'utf8');
  let Processor = null;
  class PortShim {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
    inbox(message) {
      this.port.onmessage?.({ data: message });
    }
  }
  new Function(
    'sampleRate',
    'AudioWorkletProcessor',
    'registerProcessor',
    `let currentFrame = 0; ${bundle}; return null;`,
  )(SR, PortShim, (_name, cls) => {
    Processor = cls;
  });
  return Processor;
}

/** One held note, `seconds` long; returns ns per sample and whether the voice took the kernel. */
function renderNote(Processor, patch, seconds, specialise) {
  const processor = new Processor({
    processorOptions: { maxVoices: 4, patch: structuredClone(patch), seed: 1, specialise },
  });
  const blocks = Math.ceil((seconds * SR) / BLOCK);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    cutoffMod: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  processor.inbox({ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 });
  let sum = 0;
  const started = performance.now();
  for (let b = 0; b < blocks; b++) {
    processor.process([], [[left, right]], params);
    sum += left[0];
  }
  const ns = ((performance.now() - started) * 1e6) / (blocks * BLOCK);
  const kernel = processor.voices.some((v) => v.active && v.kernel);
  return { ns, kernel, sum };
}

function held(patch) {
  for (const op of patch.ops) op.env = { ...op.env, attackTime: 0, sustainLevel: 1 };
  return patch;
}

function withOps(patch, algorithm, edits) {
  const out = structuredClone(patch);
  out.algorithm = algorithm;
  out.ops = out.ops.map((op, i) => ({ ...op, ...edits[i] }));
  return out;
}

function scenarios(repo) {
  const file = join(repo, 'packages', 'engine', 'src', 'patches', 'tr909-tom-mid.json');
  const tom = held(JSON.parse(readFileSync(file, 'utf8')).patch);
  const off = { ...tom, filter: { ...tom.filter, mode: FILTER_OFF } };
  const silent = { level: 0 };
  const lone = (cWave, dWave) =>
    withOps(off, 7, [silent, silent, { wave: cWave, level: 1 }, { wave: dWave, level: 0 }]);
  const tomC = structuredClone(tom);
  tomC.ops[OP_C] = { ...tomC.ops[OP_C], wave: NOISE };
  const snare = withOps(off, 7, [{}, {}, { wave: NOISE, level: 0.5 }, { wave: NOISE, level: 0.5 }]);
  return [
    { name: 'noise380', patch: lone(NOISE, NOISE) },
    { name: 'noise1', patch: lone(NOISE, SINE) },
    { name: 'sine1', patch: lone(SINE, SINE) },
    { name: 'tom', patch: tom },
    { name: 'tomC', patch: tomC },
    { name: 'snare7', patch: snare },
  ];
}

function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo] + (s[Math.ceil(at)] - s[lo]) * (at - lo);
}

function bench(list, { rounds, seconds }) {
  const ns = list.map(() => []);
  const kernel = list.map(() => false);
  for (let round = 0; round < rounds + WARMUP_ROUNDS; round++) {
    for (let k = 0; k < list.length; k++) {
      const i = (k + round) % list.length;
      const v = list[i];
      const r = renderNote(v.Processor, v.patch, seconds, v.specialise);
      kernel[i] = r.kernel;
      if (round >= WARMUP_ROUNDS) ns[i].push(r.ns);
    }
  }
  return list.map((v, i) => ({
    ...v,
    kernel: kernel[i],
    ns: quantile(ns[i], 0.5),
    q1: quantile(ns[i], 0.25),
    q3: quantile(ns[i], 0.75),
  }));
}

function main() {
  const { options, repo, bundles } = parseArgs(process.argv.slice(2));
  const loaded = bundles.map((b) => ({ ...b, Processor: loadProcessor(b.path) }));
  process.stdout.write(
    `node ${process.version}, ${options.rounds} rounds of ${options.seconds} s per variant\n`,
  );
  process.stdout.write('scenario  bundle    path     kernel  ns/sample median [IQR]\n');
  for (const scenario of scenarios(repo)) {
    if (options.only && scenario.name !== options.only) continue;
    const list = [];
    for (const b of loaded) {
      for (const specialise of options.generic ? [true, false] : [true]) {
        list.push({ ...scenario, bundle: b.name, Processor: b.Processor, specialise });
      }
    }
    for (const r of bench(list, options)) {
      const path = r.specialise ? 'live' : 'generic';
      const iqr = `[${r.q1.toFixed(2)}, ${r.q3.toFixed(2)}]`;
      process.stdout.write(
        `${r.name.padEnd(9)} ${r.bundle.padEnd(9)} ${path.padEnd(8)} ${String(r.kernel).padEnd(7)} ${r.ns.toFixed(2).padStart(7)} ${iqr}\n`,
      );
    }
  }
}

main();
