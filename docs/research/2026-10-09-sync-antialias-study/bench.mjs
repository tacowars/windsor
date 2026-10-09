/* global process, console, structuredClone */
/**
 * What each candidate costs a voice (windsor#652, decision 6): the method of
 * `docs/research/2026-09-15-548-fm-voice-loop-specialisation` with
 * windsor#382's timing, as `2026-10-09-operator-hard-sync/bench.mjs` runs
 * it. Research only.
 *
 *   node docs/research/2026-10-09-sync-antialias-study/bench.mjs [--rounds 30] [--seconds 5]
 *     [--variants unsynced,shipped,...]
 *
 * `lead-sync-sweep`, one held note at MIDI 60 with every envelope at its
 * peak (attack 0, sustain 1), so no operator sleeps and the voice never goes
 * dormant; wall time around the note's render, in ns per 48 kHz output
 * sample of the one voice; the variants interleaved, their order rotated
 * each round, after two warm-up rounds; the median and interquartile range.
 *
 * - `unsynced`: the patch with its sync off, so the kernel;
 * - `shipped`: synced as shipped, the generic loop;
 * - `A`, `C` and `+D`: the candidates' bundles at 48 kHz;
 * - `B2`, `B4`: the voice rendered at 2× or 4× and brought to 48 kHz by a
 *   streaming polyphase pass of `decimators.mjs`'s chain, its cost included.
 *   The whole voice runs at the higher rate here; `lead-sync-sweep`'s
 *   filter and drive are off, so that is its operators, carrier sum and pan.
 */
import { performance } from 'node:perf_hooks';

import { held, heldPart, renderBlocks } from '../2026-10-09-operator-hard-sync/workletBundle.mjs';
import { StreamDecimator } from './decimators.mjs';
import { SR, library, processorWithClock, variant } from './render.mjs';

const BLOCK = 128;
const NOTE = 60;
const WARMUP_ROUNDS = 2;
const DEFAULT = 'unsynced,shipped,shipped+D,A,A+D,C,C+D,B2,B2+D,B4,B4+D,AB2+D';

const args = { rounds: '30', seconds: '5', variants: DEFAULT, repo: '.' };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}

const synced = held(library(args.repo, 'lead-sync-sweep'));
const unsynced = structuredClone(synced);
for (const op of unsynced.ops) op.sync = 'off';

/** One run: its processor class, its patch, and its decimator chain. */
function runFor(name) {
  const v = variant(args.repo, name === 'unsynced' ? 'shipped' : name);
  const { Processor } = processorWithClock(v.text, v.rate);
  return { name, v, Processor, patch: name === 'unsynced' ? unsynced : synced };
}

/** One held note, `seconds` of output: ns per output sample. */
function time(run, seconds) {
  const { v, Processor, patch } = run;
  const processor = heldPart(Processor, patch, NOTE);
  const chain = v.stages.map((s) => new StreamDecimator(s));
  const mids = v.stages.map(() => new Float64Array(BLOCK * v.factor));
  const blocks = Math.ceil((seconds * SR) / BLOCK) * v.factor;
  let sum = 0;
  const started = performance.now();
  renderBlocks(processor, blocks, (left) => {
    let x = left;
    let n = BLOCK;
    for (let j = 0; j < chain.length; j++) {
      const d = chain[j];
      const out = mids[j];
      n /= d.factor;
      for (let m = 0; m < n; m++) out[m] = d.push(x, m * d.factor);
      x = out;
    }
    sum += x[0];
  });
  const outSamples = (blocks / v.factor) * BLOCK;
  return { ns: ((performance.now() - started) * 1e6) / outSamples, sum };
}

function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (at - lo);
}

const runs = args.variants.split(',').map(runFor);
const times = runs.map(() => []);
const rounds = Number(args.rounds);
for (let round = 0; round < WARMUP_ROUNDS + rounds; round++) {
  for (let k = 0; k < runs.length; k++) {
    const i = (k + round) % runs.length;
    const { ns } = time(runs[i], Number(args.seconds));
    if (round >= WARMUP_ROUNDS) times[i].push(ns);
  }
}
const base = quantile(times[0], 0.5);
console.log(`| Variant | ns per sample, median (IQR) | × ${runs[0].name} |`);
console.log('|---|---|---|');
runs.forEach((run, i) => {
  const [q1, med, q3] = [0.25, 0.5, 0.75].map((q) => quantile(times[i], q));
  console.log(
    `| ${run.name} | ${med.toFixed(1)} (${q1.toFixed(1)}–${q3.toFixed(1)}) | ${(med / base).toFixed(2)} |`,
  );
});
