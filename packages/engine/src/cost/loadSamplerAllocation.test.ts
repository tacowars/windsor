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
 * so its path is hot either way.
 *
 * What it pins:
 *
 * - The meter costs two heap numbers a quantum, 32 bytes, and nothing more:
 *   each `Date.now()` returns a new one, which no source form avoids (the
 *   research README has V8's graph). Where the render allocates nothing of
 *   its own (the EQ and the output stage), the difference between the two
 *   runs is held to that within 8 bytes a quantum. Where the DSP still
 *   allocates, its own bytes vary from run to run with V8's tiering (the
 *   Retro reverb's differed by 4 KB a quantum between two runs on CI), so the
 *   difference measures nothing there and is not asserted until that
 *   processor's allocation ticket makes it clean (windsor#226–#233).
 * - No field the sampler writes changes its representation: no
 *   generalisation the trace places inside the bundle's `LoadSampler`.
 * - The processors whose render allocates nothing with the meter off (the EQ
 *   and the output stage) still do not.
 *
 * What it does not: the other eight renders allocate with the meter off,
 * from their DSP, and their fields generalise (the README's table). That is
 * not the sampler's, and a cut record in their trace cannot be placed, so
 * cut pairs are not read here; `inserts/eqAllocation.test.ts` holds the EQ,
 * whose trace is empty, to the strict rule.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runAllocationProbe, workletBundle } from '../__fixtures__/workletAllocation';
import type { ProbeRun } from '../__fixtures__/workletAllocation';
import { PRESETS } from '../patch/presets';

const WARMUP = 16000;
const LOAD_QUANTA = 64;
/** Two heap numbers a quantum, and the slack either way. */
const METER_BYTES = 32;
const METER_SLACK = 8;
const CLEAN_TOLERANCE_BYTES = 16 * 1024;
const CHORD = [48, 55, 60, 64];

/**
 * Each bundle and its measured quanta: as many as fit the young generation
 * with no collection (the drive allocates about 100 KB a quantum).
 */
const BUNDLES: [string, number][] = [
  ['fm-processor.js', 2000],
  ['advanced-drive-processor.js', 400],
  ['compressor-processor.js', 2000],
  ['delay-processor.js', 2000],
  ['eq-processor.js', 2000],
  ['output-stage-processor.js', 2000],
  ['phaser-processor.js', 2000],
  ['retro-reverb-processor.js', 2000],
  ['reverb-processor.js', 1000],
  ['tape-processor.js', 2000],
];
const CLEAN = new Set(['eq-processor.js', 'output-stage-processor.js']);

function probe(bundle: string, loadQuanta: number, measure: number): ProbeRun {
  const fm = bundle === 'fm-processor.js';
  return runAllocationProbe({
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
    measure,
  });
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
    (bundle, measure) => {
      const off = probe(bundle, 0, measure);
      const on = probe(bundle, LOAD_QUANTA, measure);
      expect(off.gcs + on.gcs, 'no collection ran while the heap was read').toBe(0);
      const detail = `off ${off.windows.join(' ')}; on ${on.windows.join(' ')}`;
      expect(within(on.changes, bundle, samplerLines(bundle))).toEqual([]);
      if (!CLEAN.has(bundle)) return;
      expect(off.bytes, detail).toBeLessThan(CLEAN_TOLERANCE_BYTES);
      const perQuantum = (on.bytes - off.bytes) / measure;
      expect(Math.abs(perQuantum - METER_BYTES), detail).toBeLessThanOrEqual(METER_SLACK);
    },
    120_000,
  );
});
