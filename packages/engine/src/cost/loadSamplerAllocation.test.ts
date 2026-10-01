/**
 * What the load sampler (`worklet/loadSampler.ts`, #445) costs the audio
 * thread in each of the ten processors that bundle it (windsor#214), measured
 * on V8 rather than read off the source.
 *
 * Method: `__fixtures__/workletAllocation.ts` runs the shipped bundle in a
 * Node of its own (`workletAllocationProbe.ts`) twice, a steady render with
 * the meter off and one with it reporting every 64 quanta, reads
 * `used_heap_size` over the measured run with no collection in it, and reads
 * V8's `--trace-generalization`. An insert renders stereo noise at its
 * parameters' defaults; the FM part renders a held four-note chord of
 * `pad-drift`. The warm-up runs the sampler for its first half in both runs,
 * so its path is hot either way. V8 compiles on the main thread
 * (`SYNCHRONOUS_TIERING`), so the tier the render has reached when the heap is
 * read does not depend on the machine's load: with the compiler on a
 * background thread, the output stage's meter-off run read 182 bytes a
 * quantum on a busy CI runner, the same on two branches, as a render still
 * below its optimised tier does (windsor#256).
 *
 * What it pins:
 *
 * - The meter costs two heap numbers a quantum, 32 bytes, and nothing more:
 *   each `Date.now()` returns a new one, which no source form avoids (the
 *   research README has V8's graph). Where the render allocates nothing of
 *   its own (every bundle in `CLEAN`), the difference between the two runs is
 *   held to that within 8 bytes a quantum. Tape's DSP still allocates, and its
 *   own bytes vary from run to run with V8's tiering, so the difference
 *   measures nothing there and is not asserted until windsor#228 makes it
 *   clean.
 * - No field the sampler writes changes its representation: no
 *   generalisation the trace places inside the bundle's `LoadSampler`.
 * - Every processor whose render allocates nothing with the meter off still
 *   does not. Each one's own allocation test holds it to that as well; this
 *   repeats it under the sampler's harness.
 *
 * The warm-up is 24000 quanta because the probe's process allocates a one-off
 * 3 to 17 KB about 18000 quanta in, in every bundle and at any measured
 * length: with a 16000-quantum warm-up it fell inside the measured run and
 * put the drive, the Phaser and the Retro reverb over the bound, though their
 * totals were the same at 2000 and 8000 measured quanta.
 *
 * What it does not: Tape's render allocates with the meter off, from its DSP,
 * which is not the sampler's. Representation changes outside the sampler's
 * lines, and cut pairs, which a trace cannot place, are not read here; each
 * processor's own allocation test reads its whole trace, as
 * `inserts/eqAllocation.test.ts` does the EQ's.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  runAllocationProbe,
  SYNCHRONOUS_TIERING,
  workletBundle,
} from '../__fixtures__/workletAllocation';
import type { ProbeRun } from '../__fixtures__/workletAllocation';
import { PRESETS } from '../patch/presets';

const WARMUP = 24000;
const LOAD_QUANTA = 64;
/** Two heap numbers a quantum, and the slack either way. */
const METER_BYTES = 32;
const METER_SLACK = 8;
const CLEAN_TOLERANCE_BYTES = 16 * 1024;
const CHORD = [48, 55, 60, 64];

/**
 * The measured quanta. With the meter off, every bundle's run now fits the
 * young generation with room to spare; Tape, the largest, reads about 28 MB.
 */
const MEASURE = 2000;
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
/** The bundles whose render allocates nothing with the meter off, and the PR that made each so. */
const CLEAN = new Set([
  'eq-processor.js', // already clean when windsor#221 measured it
  'output-stage-processor.js', // likewise
  'advanced-drive-processor.js', // windsor#239
  'reverb-processor.js', // windsor#236
  'compressor-processor.js', // windsor#241
  'retro-reverb-processor.js', // windsor#244
  'phaser-processor.js', // windsor#248
  'delay-processor.js', // windsor#249
  'fm-processor.js', // windsor#257
  'tape-processor.js', // windsor#265
]);

function probe(bundle: string, loadQuanta: number): ProbeRun {
  const fm = bundle === 'fm-processor.js';
  return runAllocationProbe(
    {
      bundle: workletBundle(bundle),
      rate: 48000,
      params: {},
      options: fm ? { maxVoices: 16, patch: PRESETS['pad-drift'], seed: 0xa204 } : {},
      messages: fm
        ? CHORD.map((note, id) => ({ type: 'noteOn', id, note, velocity: 0.8, frame: 0 }))
        : [],
      inputChannels: fm ? 0 : 2,
      loadQuanta,
      warmup: WARMUP,
      measure: MEASURE,
    },
    SYNCHRONOUS_TIERING,
  );
}

/** The bundle's lines that hold `class LoadSampler`, first to last. */
function samplerLines(bundle: string): [number, number] {
  const lines = readFileSync(workletBundle(bundle), 'utf8').split('\n');
  const first = lines.indexOf('var LoadSampler = class {') + 1;
  const last = lines.indexOf('};', first) + 1;
  expect(first, 'the bundle carries the sampler').toBeGreaterThan(0);
  return [first, last];
}

/** The changes the trace places on the bundle's lines [first, last]. */
function within(changes: string[], bundle: string, [first, last]: [number, number]): string[] {
  const at = new RegExp(` at ${bundle.replace('.', '\\.')}:(\\d+)\\]`, 'g');
  return changes.filter((change) =>
    [...change.matchAll(at)].some(([, line]) => Number(line) >= first && Number(line) <= last),
  );
}

describe('the load sampler on V8', () => {
  it.each(BUNDLES)(
    '%s: the meter costs two heap numbers a quantum and generalises nothing',
    (bundle) => {
      const off = probe(bundle, 0);
      const on = probe(bundle, LOAD_QUANTA);
      expect(off.gcs + on.gcs, 'no collection ran while the heap was read').toBe(0);
      const detail = `off ${off.windows.join(' ')}; on ${on.windows.join(' ')}`;
      expect(within(on.changes, bundle, samplerLines(bundle))).toEqual([]);
      if (!CLEAN.has(bundle)) return;
      expect(off.bytes, detail).toBeLessThan(CLEAN_TOLERANCE_BYTES);
      const perQuantum = (on.bytes - off.bytes) / MEASURE;
      expect(Math.abs(perQuantum - METER_BYTES), detail).toBeLessThanOrEqual(METER_SLACK);
    },
    120_000,
  );
});
