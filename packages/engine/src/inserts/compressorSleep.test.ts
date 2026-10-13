/**
 * The Compressor's sleep (windsor#793, `COMPRESSOR_SLEEP`), on the shipped
 * bundle: a compressor at rest sleeps on its first silent block; fed silence
 * after full-scale noise it sleeps once its envelope has released to the
 * floor, within `tailSeconds` at the deepest reduction, and writes exact
 * zeros; a loud external key keeps it awake under a silent program; fed noise
 * again it wakes on that block and renders what a compressor built with
 * `sleep: false` renders, to within the floor, also when it was switched off
 * while it slept (the switch fades asleep as awake); and a render that never goes
 * silent is the same bits with the sleep or without it.
 */
import { describe, expect, it } from 'vitest';
import { compressorParams, loadCompressor } from '../__fixtures__/compressorHarness';
import {
  join,
  largestDifference,
  noise,
  peakFrom,
  QUANTUM,
  runBlocks,
  runLegs,
  silence,
  type SleepingProcessor,
} from '../__fixtures__/insertSleepRun';
import { COMPRESSOR_SLEEP } from './compressorConstants';
import type { CompressorSpec } from './compressorSpec';

const RATE = 48000;
const LOUD = 40;
const TAIL_BLOCKS = Math.ceil((COMPRESSOR_SLEEP.tailSeconds * RATE) / QUANTUM);
const FLOOR = 1e-7;

const compressor = (spec: Partial<CompressorSpec>, sleep = true): SleepingProcessor =>
  loadCompressor(RATE, compressorParams(spec), { sleep }) as unknown as SleepingProcessor;

/** The defaults, the deepest reduction on Auto, and on the slowest manual release. */
const SPECS: Partial<CompressorSpec>[] = [
  {},
  { threshold: -40, ratio: 10, attack: 0.01, makeup: 24 },
  { threshold: -40, ratio: 10, attack: 0.01, release: 1.2, highpass: 20 },
];

describe('the Compressor asleep', () => {
  it('sleeps on its first silent block while its envelope is at rest', () => {
    const run = runBlocks(compressor({}), compressorParams(), silence(4), 4);
    expect(run.asleep).toEqual([true, true, true, true]);
    expect(peakFrom(run, 0)).toBe(0);
  });

  it.each(SPECS)('sleeps within its tail after noise and writes zeros: %o', (spec) => {
    const run = runBlocks(
      compressor(spec),
      compressorParams(spec),
      noise(LOUD),
      LOUD + TAIL_BLOCKS,
    );
    const slept = run.asleep.indexOf(true);
    expect(slept).toBeGreaterThan(LOUD);
    expect(run.asleep.slice(slept).every(Boolean)).toBe(true);
    expect(peakFrom(run, slept)).toBe(0);
  });

  it('stays awake under a silent program while its external key is loud', () => {
    const params = compressorParams();
    params.external![0] = 1;
    const processor = compressor({});
    const key = noise(1);
    for (let b = 0; b < 8; b++) {
      const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
      processor.process([[new Float32Array(QUANTUM)], key], [out], params);
      expect(processor.dsp.asleep).toBe(false);
    }
  });

  it.each(SPECS)(
    'wakes on the first loud block, continuous with no sleep: %o',
    (spec) => {
      const quiet = TAIL_BLOCKS;
      const source = join(noise(LOUD), silence(quiet), noise(LOUD, 7));
      const blocks = LOUD + quiet + LOUD;
      const sleeping = runBlocks(compressor(spec), compressorParams(spec), source, blocks);
      const awake = runBlocks(compressor(spec, false), compressorParams(spec), source, blocks);
      expect(sleeping.asleep[LOUD + quiet - 1]).toBe(true);
      expect(sleeping.asleep[LOUD + quiet]).toBe(false);
      expect(awake.asleep.includes(true)).toBe(false);
      expect(largestDifference(sleeping, awake)).toBeLessThan(FLOOR);
    },
    20_000,
  );

  it('fades its switch while asleep as it would awake', () => {
    const spec = { threshold: -40, ratio: 10, attack: 0.01 };
    const bypassed = compressorParams(spec);
    bypassed.enabled![0] = 0;
    const legs = (): Parameters<typeof runLegs>[1] => [
      { params: compressorParams(spec), source: silence(1), blocks: 1 },
      { params: bypassed, source: silence(1), blocks: 1 },
      { params: bypassed, source: noise(8), blocks: 8 },
    ];
    const sleeping = runLegs(compressor(spec), legs());
    const awake = runLegs(compressor(spec, false), legs());
    expect(sleeping.asleep.slice(0, 2)).toEqual([true, true]);
    expect(largestDifference(sleeping, awake)).toBeLessThan(FLOOR);
  });

  it('renders a signal that never goes silent to the same bits as without the sleep', () => {
    const source = noise(400, 3);
    const sleeping = runBlocks(compressor({}), compressorParams(), source, 400);
    const awake = runBlocks(compressor({}, false), compressorParams(), source, 400);
    expect(sleeping.left).toEqual(awake.left);
    expect(sleeping.right).toEqual(awake.right);
    expect(sleeping.asleep.includes(true)).toBe(false);
  });
});
