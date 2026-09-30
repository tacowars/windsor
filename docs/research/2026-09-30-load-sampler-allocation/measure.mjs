/* global process, console */
/**
 * Heap growth per render quantum for every worklet processor, with the load
 * meter off and on (windsor#214), run from the repository root:
 *
 *   node docs/research/2026-09-30-load-sampler-allocation/measure.mjs [quanta] [bundle dir] [prefix]
 *
 * Each case is three runs of `__fixtures__/workletAllocationProbe.ts` in a
 * Node of its own with `--expose-gc` and a 64 MB young generation: 16 000
 * quanta of warm-up (the meter on for the first half), then `quanta` measured
 * (default 2 000). An insert renders stereo noise at its parameters' defaults;
 * the FM part a held four-note chord of `pad-drift`. It prints bytes per
 * quantum for each run, `(gcN)` when a collection fell in the measured run
 * (that reading means nothing: shorten the run), and the count of
 * representation changes the trace attributes to the bundle. `bundle dir`
 * defaults to `packages/engine/src/worklet/generated/`; pass another build's
 * (for example `git archive origin/main`'s) to compare. `prefix` keeps only
 * the bundles whose file name starts with it.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = join(process.cwd(), 'packages/engine/src');
const measure = Number(process.argv[2] ?? 2000);
const dir = process.argv[3] || join(src, 'worklet/generated');
const only = process.argv[4] ?? '';
const probe = join(src, '__fixtures__/workletAllocationProbe.ts');
const { representationChanges } = await import(join(src, '__fixtures__/generalizationTrace.ts'));
const pad = JSON.parse(readFileSync(join(src, 'patches/pad-drift.json'), 'utf8')).patch;
const BUNDLES = [
  'fm-processor.js',
  'advanced-drive-processor.js',
  'compressor-processor.js',
  'delay-processor.js',
  'eq-processor.js',
  'output-stage-processor.js',
  'phaser-processor.js',
  'retro-reverb-processor.js',
  'reverb-processor.js',
  'tape-processor.js',
];
const FLAGS = [
  '--expose-gc',
  '--min-semi-space-size=64',
  '--max-semi-space-size=64',
  '--trace-generalization',
  '--no-warnings',
];

function config(bundle, loadQuanta) {
  const fm = bundle === 'fm-processor.js';
  const chord = [48, 55, 60, 64];
  return {
    bundle: join(dir, bundle),
    rate: 48000,
    params: {},
    options: fm ? { maxVoices: 16, patch: pad, seed: 0xa204 } : {},
    messages: fm
      ? chord.map((note, id) => ({ type: 'noteOn', id, note, velocity: 0.8, frame: 0 }))
      : [],
    inputChannels: fm ? 0 : 2,
    loadQuanta,
    warmup: 16000,
    measure,
  };
}

function run(bundle, loadQuanta) {
  const out = mkdtempSync(join(tmpdir(), 'load-sampler-'));
  try {
    const file = join(out, 'result.json');
    const args = [...FLAGS, probe, JSON.stringify(config(bundle, loadQuanta)), file];
    const child = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (child.status !== 0) throw new Error(`${bundle}: ${child.stderr}`);
    const result = JSON.parse(readFileSync(file, 'utf8'));
    const changes = representationChanges(child.stdout, bundle).length;
    const perQuantum = (result.bytes / measure).toFixed(2);
    return { text: `${perQuantum}${result.gcs ? `(gc${result.gcs})` : ''}`, changes };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

for (const bundle of BUNDLES.filter((b) => b.startsWith(only))) {
  const row = [bundle.padEnd(28)];
  for (const loadQuanta of [0, 64]) {
    const runs = [0, 1, 2].map(() => run(bundle, loadQuanta));
    row.push(loadQuanta ? 'on' : 'off', runs.map((r) => r.text).join(' ').padEnd(34));
    row.push(`changes ${runs[0].changes}`);
  }
  console.log(row.join(' '));
}
