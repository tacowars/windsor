/* global process, console, structuredClone */
/**
 * The synced voice at twice the rate (windsor#656, decision 9): its CPU
 * against the direct shape at the part's rate, in one run. Research only.
 *
 *   node docs/research/2026-10-09-sync-antialias-build/interleaved2x.mjs
 *     [--direct ca831a6] [--rounds 20] [--seconds 3]
 *
 * `interleaved.mjs`'s method (the study's `bench.mjs`): wall time around a
 * held render, ns per 48 kHz sample of one voice, the runs interleaved and
 * rotated each round after two warm-up rounds, the median and interquartile
 * range. Three bundles: `A + D` (`--direct`, windsor#655's), `built at 1×`
 * (this checkout's with the part's `syncOversample` off) and `built`. Three
 * patches, each `lead-sync-sweep` with every envelope at its peak:
 * - as shipped, drive and filter off, one note at MIDI 60;
 * - with the Acid ladder (cutoff 1.2 kHz, Reso 0.6) and the soft drive at
 *   gain 2, one note at MIDI 60;
 * - as shipped, 16 notes at once (MIDI 48 to 63), the time over 16 voices.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { held, renderBlocks } from '../2026-10-09-operator-hard-sync/workletBundle.mjs';
import { SR, library, processorWithClock } from '../2026-10-09-sync-antialias-study/render.mjs';
import { at1x } from './voice2xBundles.mjs';

const BLOCK = 128;
const WARMUP_ROUNDS = 2;
const BUNDLE = 'packages/engine/src/worklet/generated/fm-processor.js';
const FILT_LADDER = 6;
const VOICES = 16;

const args = { direct: 'ca831a6', rounds: '20', seconds: '3' };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}

const directText = execFileSync('git', ['show', `${args.direct}:${BUNDLE}`], { encoding: 'utf8' });
const builtText = readFileSync(BUNDLE, 'utf8');
const sweep = held(library('.', 'lead-sync-sweep'));
const acid = structuredClone(sweep);
acid.filter = { ...acid.filter, mode: FILT_LADDER, cutoff: 1200, resonance: 0.6 };
acid.drive = { ...acid.drive, on: true, gain: 2 };

const BUNDLES = [
  [`A + D (${args.direct})`, directText],
  ['built at 1×', at1x(builtText)],
  ['built', builtText],
];
const PATCHES = [
  ['as shipped', sweep, 1],
  ['Acid + drive', acid, 1],
  ['16 voices', sweep, VOICES],
];
const runs = PATCHES.flatMap(([patchName, patch, voices]) =>
  BUNDLES.map(([name, text]) => ({
    name: `${patchName}: ${name}`,
    patch,
    voices,
    Processor: processorWithClock(text, SR).Processor,
  })),
);

/** `voices` notes held from MIDI 60 (one) or 48 up (several), seed 1. */
function part(run) {
  const processor = new run.Processor({
    processorOptions: { maxVoices: VOICES, patch: structuredClone(run.patch), seed: 1 },
  });
  for (let v = 0; v < run.voices; v++) {
    const note = run.voices === 1 ? 60 : 48 + v;
    processor.inbox({ type: 'noteOn', id: v + 1, note, velocity: 1, frame: 0 });
  }
  return processor;
}

/** One held part, `seconds` of audio over its voices: ns per voice-sample. */
function time(run, seconds) {
  const processor = part(run);
  const blocks = Math.ceil((seconds * SR) / BLOCK / run.voices);
  const started = performance.now();
  renderBlocks(processor, blocks, () => {});
  return ((performance.now() - started) * 1e6) / (blocks * BLOCK * run.voices);
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
console.log('| Run | ns per voice-sample, median (IQR) | × A + D |');
console.log('|---|---|---|');
runs.forEach((run, i) => {
  const base = quantile(times[i - (i % BUNDLES.length)], 0.5);
  const [q1, med, q3] = [0.25, 0.5, 0.75].map((q) => quantile(times[i], q));
  console.log(
    `| ${run.name} | ${med.toFixed(1)} (${q1.toFixed(1)}–${q3.toFixed(1)}) | ${(med / base).toFixed(2)} |`,
  );
});
