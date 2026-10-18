/**
 * The Transient's sleep (record `2026-10-18-transient-insert` decision 8,
 * the compressor's pattern), on the shipped bundle: one at rest sleeps on
 * its first silent block; after noise it sleeps once its window and
 * followers have released under `TRANSIENT_SLEEP.floor`, which is the
 * plate's 1e-9 over the +45 dB the shaping and the Output can add; a quiet
 * input above that floor, which that gain would lift into hearing, keeps it
 * awake; asleep it plays the input at the Output's gain, as an awake one
 * plays such a block; and fed noise again it wakes on that block and renders
 * what one built with `sleep: false` renders, to the plate's floor, also
 * when its controls and its switch moved while it slept.
 */
import { describe, expect, it } from 'vitest';
import {
  join,
  largestDifference,
  noise,
  QUANTUM,
  runBlocks,
  runLegs,
  silence,
  type SleepingProcessor,
} from '../__fixtures__/insertSleepRun';
import { loadTransient, transientParams } from '../__fixtures__/transientHarness';
import { TRANSIENT_BOUNDS, TRANSIENT_SLEEP, TRANSIENT_WORST_GAIN_DB } from './transientConstants';
import type { TransientSpec } from './transientSpec';
import { TRANSIENT_SHIPPED_TIMING, TRANSIENT_TIMINGS } from './transientTables';

const RATE = 48000;
const LOUD = 40;
const FLOOR = 1e-7;
/** The slowest follower's release from full scale to the floor, in blocks: the tail. */
const TAIL_BLOCKS = Math.ceil(
  (TRANSIENT_TIMINGS[TRANSIENT_SHIPPED_TIMING].sReleaseMs / 1000) *
    Math.log(1 / TRANSIENT_SLEEP.floor) *
    (RATE / QUANTUM) *
    1.1,
);

const transient = (spec: Partial<TransientSpec>, sleep = true): SleepingProcessor =>
  loadTransient(RATE, transientParams(spec), { sleep }) as unknown as SleepingProcessor;

/** The neutral defaults, the deepest shaping with the loudest Output, and a parallel mix. */
const SPECS: Partial<TransientSpec>[] = [
  {},
  { attack: 15, sustain: 24, output: 6 },
  { attack: -15, sustain: -24, output: -20, mix: 0.5 },
];

/** A constant level `v`, stereo, `blocks` quanta long. */
const level = (v: number, blocks: number): Float32Array[] =>
  [0, 1].map(() => new Float32Array(blocks * QUANTUM).fill(v));

describe('the Transient asleep', () => {
  it('derives its floor from the bounds: the plate’s 1e-9 over +45 dB', () => {
    const B = TRANSIENT_BOUNDS;
    expect(TRANSIENT_WORST_GAIN_DB).toBe(B.attack[1] + B.sustain[1] + B.output[1]);
    expect(TRANSIENT_SLEEP.floor).toBeCloseTo(1e-9 / 10 ** (45 / 20), 20);
  });

  it('sleeps on its first silent block while it is at rest', () => {
    const run = runBlocks(transient({}), transientParams(), silence(4), 4);
    expect(run.asleep).toEqual([true, true, true, true]);
  });

  it.each(SPECS)('sleeps within its tail after noise: %o', (spec) => {
    const run = runBlocks(transient(spec), transientParams(spec), noise(LOUD), LOUD + TAIL_BLOCKS);
    const slept = run.asleep.indexOf(true);
    expect(slept).toBeGreaterThan(LOUD);
    expect(run.asleep.slice(slept).every(Boolean)).toBe(true);
  });

  it('stays awake on a quiet input the worst-case gain would make audible', () => {
    const quiet = 4 * TRANSIENT_SLEEP.floor;
    const spec = { attack: 15, sustain: 24, output: 6 };
    const run = runBlocks(transient(spec), transientParams(spec), level(quiet, 8), 8);
    expect(run.asleep.includes(true)).toBe(false);
  });

  it('plays an input under the floor at the Output’s gain, as an awake one does', () => {
    const under = 0.5 * TRANSIENT_SLEEP.floor;
    const spec = { attack: 15, sustain: 24, output: 6, mix: 0.3 };
    const source = level(under, 16);
    const sleeping = runBlocks(transient(spec), transientParams(spec), source, 16);
    const awake = runBlocks(transient(spec, false), transientParams(spec), source, 16);
    expect(sleeping.asleep.every(Boolean)).toBe(true);
    expect(sleeping.left).toEqual(awake.left);
    expect(sleeping.right).toEqual(awake.right);
  });

  it.each(SPECS)(
    'wakes on the first loud block, continuous with no sleep: %o',
    (spec) => {
      const quiet = TAIL_BLOCKS;
      const source = join(noise(LOUD), silence(quiet), noise(LOUD, 7));
      const blocks = LOUD + quiet + LOUD;
      const sleeping = runBlocks(transient(spec), transientParams(spec), source, blocks);
      const awake = runBlocks(transient(spec, false), transientParams(spec), source, blocks);
      expect(sleeping.asleep[LOUD + quiet - 1]).toBe(true);
      expect(sleeping.asleep[LOUD + quiet]).toBe(false);
      expect(awake.asleep.includes(true)).toBe(false);
      expect(largestDifference(sleeping, awake)).toBeLessThan(FLOOR);
    },
    20_000,
  );

  it('moves its controls and fades its switch while asleep as it would awake', () => {
    const spec = { attack: 15, sustain: -24 };
    const moved = transientParams({ attack: -9, sustain: 20, output: -6, mix: 0.6 });
    const off = transientParams({ ...spec, enabled: false });
    const legs = (): Parameters<typeof runLegs>[1] => [
      { params: transientParams(spec), source: silence(2), blocks: 2 },
      { params: moved, source: silence(2), blocks: 2 },
      { params: moved, source: noise(8), blocks: 8 },
      { params: off, source: silence(1), blocks: 1 },
      { params: off, source: noise(4, 3), blocks: 4 },
    ];
    const sleeping = runLegs(transient(spec), legs());
    const awake = runLegs(transient(spec, false), legs());
    expect(sleeping.asleep.slice(0, 4)).toEqual([true, true, true, true]);
    expect(largestDifference(sleeping, awake)).toBeLessThan(FLOOR);
  });

  it('renders a signal that never goes silent to the same bits as without the sleep', () => {
    const spec = { attack: 10, sustain: -12 };
    const source = noise(400, 3);
    const sleeping = runBlocks(transient(spec), transientParams(spec), source, 400);
    const awake = runBlocks(transient(spec, false), transientParams(spec), source, 400);
    expect(sleeping.left).toEqual(awake.left);
    expect(sleeping.right).toEqual(awake.right);
    expect(sleeping.asleep.includes(true)).toBe(false);
  });
});
