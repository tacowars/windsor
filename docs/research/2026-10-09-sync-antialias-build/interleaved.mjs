/* global process, console, structuredClone */
/**
 * The built direct shape's CPU against shipped's in one run (windsor#655,
 * decision 8). Research only.
 *
 *   node docs/research/2026-10-09-sync-antialias-build/interleaved.mjs [--base 9ea3051]
 *     [--rounds 30] [--seconds 5]
 *
 * The study's `bench.mjs` reads one checkout's bundle per run, so it cannot
 * set shipped and built side by side. This is its method with the bundles
 * from `build.mjs`: `lead-sync-sweep` with every envelope at its peak
 * (`workletBundle.mjs`'s `held`), one held note at MIDI 60, wall time around
 * 5 s of the one voice, in ns per 48 kHz sample; the runs interleaved and
 * rotated each round, after two warm-up rounds; the median and
 * interquartile range. `unsynced` is the patch with its sync off, the kernel.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { held, heldPart, renderBlocks } from '../2026-10-09-operator-hard-sync/workletBundle.mjs';
import { direct, fineRatio } from '../2026-10-09-sync-antialias-study/candidates.mjs';
import { SR, library, processorWithClock } from '../2026-10-09-sync-antialias-study/render.mjs';

const BLOCK = 128;
const NOTE = 60;
const WARMUP_ROUNDS = 2;
const BUNDLE = 'packages/engine/src/worklet/generated/fm-processor.js';

const args = { base: '9ea3051', rounds: '30', seconds: '5' };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}

const baseText = execFileSync('git', ['show', `${args.base}:${BUNDLE}`], { encoding: 'utf8' });
const builtText = readFileSync(BUNDLE, 'utf8');
const synced = held(library('.', 'lead-sync-sweep'));
const unsynced = structuredClone(synced);
for (const op of unsynced.ops) op.sync = 'off';

const runs = [
  ['shipped, unsynced', baseText, unsynced],
  ['built, unsynced', builtText, unsynced],
  ['shipped', baseText, synced],
  ['shipped + D', fineRatio(baseText), synced],
  ['study A + D', fineRatio(direct(baseText, 2)), synced],
  ['built', builtText, synced],
].map(([name, text, patch]) => ({ name, patch, Processor: processorWithClock(text, SR).Processor }));

/** One held note, `seconds` long: ns per sample. */
function time(run, seconds) {
  const processor = heldPart(run.Processor, run.patch, NOTE);
  const blocks = Math.ceil((seconds * SR) / BLOCK);
  const started = performance.now();
  renderBlocks(processor, blocks, () => {});
  return ((performance.now() - started) * 1e6) / (blocks * BLOCK);
}

function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (at - lo);
}

const times = runs.map(() => []);
const rounds = Number(args.rounds);
for (let round = 0; round < WARMUP_ROUNDS + rounds; round++) {
  for (let k = 0; k < runs.length; k++) {
    const i = (k + round) % runs.length;
    const ns = time(runs[i], Number(args.seconds));
    if (round >= WARMUP_ROUNDS) times[i].push(ns);
  }
}
const base = quantile(times[2], 0.5);
console.log('| Run | ns per sample, median (IQR) | × shipped |');
console.log('|---|---|---|');
runs.forEach((run, i) => {
  const [q1, med, q3] = [0.25, 0.5, 0.75].map((q) => quantile(times[i], q));
  console.log(
    `| ${run.name} | ${med.toFixed(1)} (${q1.toFixed(1)}–${q3.toFixed(1)}) | ${(med / base).toFixed(2)} |`,
  );
});
