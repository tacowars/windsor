/* global process, console, structuredClone */
/**
 * What hard sync costs a voice (windsor#646, record decision 13), on the
 * shipped FM bundle under Node: the method of
 * `docs/research/2026-09-15-548-fm-voice-loop-specialisation` with
 * windsor#382's timing (`docs/research/2026-10-02-noise-operator-cost`).
 * Research only.
 *
 *   node bench.mjs <repo> [--rounds 30] [--seconds 5] [--only <scenario>]
 *
 * One held note at MIDI 60, every envelope at its peak (attack 0, sustain
 * 1), so no operator sleeps and the voice never goes dormant; wall time
 * around the note's render, in ns per output sample of the one voice; the
 * variants interleaved with their order rotated each round, after two
 * warm-up rounds; the median over rounds and its interquartile range. Each
 * scenario plays three variants:
 *
 * - `synced`: as written, so the generic loop (a synced voice never takes
 *   the kernel);
 * - `kernel`: every sync off, the path an unsynced voice takes;
 * - `generic`: every sync off and `specialise: false`, the generic loop
 *   without sync, which separates the loop's cost from the resets'.
 *
 * Scenarios: the two factory patches, and a four-operator chain on
 * Additive (B on the note, C on B, A on D, every operator sounding).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { bundleText, held, heldPart, processorClass, renderBlocks } from './workletBundle.mjs';

const SR = 48000;
const BLOCK = 128;
const NOTE = 60;
const WARMUP_ROUNDS = 2;

function parseArgs(argv) {
  const options = { rounds: 30, seconds: 5, only: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') options.only = argv[++i];
    else if (argv[i].startsWith('--')) options[argv[i].slice(2)] = Number(argv[++i]);
    else positional.push(argv[i]);
  }
  if (positional.length !== 1) {
    process.stderr.write('usage: node bench.mjs <repo> [--rounds 30] [--seconds 5] [--only s]\n');
    process.exit(2);
  }
  return { repo: positional[0], ...options };
}

const library = (repo, id) =>
  JSON.parse(readFileSync(join(repo, 'packages/engine/src/patches', `${id}.json`), 'utf8')).patch;

/** Four sounding operators on Additive: B on the note, C on B, A on D. */
function chain() {
  const env = { attackTime: 0, decayTime: 0.01, sustainLevel: 1, releaseTime: 0.1 };
  return {
    algorithm: 7,
    filter: { mode: 0 },
    ops: [
      { wave: 1, ratio: 1.5, level: 0.5, sync: 'D', env },
      { wave: 0, ratio: 1.6, level: 0.5, sync: 'note', env },
      { wave: 1, ratio: 2.37, level: 0.5, sync: 'B', env },
      { wave: 0, ratio: 1.01, level: 0.5, env },
    ],
  };
}

const unsynced = (patch) => {
  const out = structuredClone(patch);
  for (const op of out.ops) op.sync = 'off';
  return out;
};

function scenarios(repo) {
  const all = [
    { name: 'lead-sync-sweep', patch: held(library(repo, 'lead-sync-sweep')) },
    { name: 'lead-sync-detune', patch: held(library(repo, 'lead-sync-detune')) },
    { name: 'chain4', patch: chain() },
  ];
  return all.flatMap(({ name, patch }) => [
    { scenario: name, variant: 'synced', patch, specialise: true },
    { scenario: name, variant: 'kernel', patch: unsynced(patch), specialise: true },
    { scenario: name, variant: 'generic', patch: unsynced(patch), specialise: false },
  ]);
}

/** One held note, `seconds` long: ns per sample, and whether the voice took the kernel. */
function time(Processor, run, seconds) {
  const processor = heldPart(Processor, run.patch, NOTE, run.specialise);
  let sum = 0;
  const started = performance.now();
  renderBlocks(processor, Math.ceil((seconds * SR) / BLOCK), (left) => (sum += left[0]));
  const ns = ((performance.now() - started) * 1e6) / (Math.ceil((seconds * SR) / BLOCK) * BLOCK);
  const kernel = processor.voices.some((v) => v.active && v.kernel);
  return { ns, kernel, sum };
}

function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (at - lo);
}

const args = parseArgs(process.argv.slice(2));
const Processor = processorClass(bundleText(args.repo), SR);
const runs = scenarios(args.repo).filter((r) => !args.only || r.scenario === args.only);
const times = runs.map(() => []);
const kernels = runs.map(() => false);
for (let round = 0; round < WARMUP_ROUNDS + args.rounds; round++) {
  for (let k = 0; k < runs.length; k++) {
    const i = (k + round) % runs.length;
    const { ns, kernel } = time(Processor, runs[i], args.seconds);
    kernels[i] = kernel;
    if (round >= WARMUP_ROUNDS) times[i].push(ns);
  }
}
runs.forEach((run, i) => {
  const [q1, med, q3] = [0.25, 0.5, 0.75].map((q) => quantile(times[i], q));
  console.log(
    `${run.scenario} ${run.variant}: ${med.toFixed(1)} ns/sample ` +
      `(IQR ${q1.toFixed(1)}–${q3.toFixed(1)}), kernel ${kernels[i]}`,
  );
});
