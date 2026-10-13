/**
 * The phaser's sleep (windsor#793, `PHASER_SLEEP`), on the shipped bundle:
 * fed silence after full-scale noise it sleeps within its tail, at the
 * slowest corner too, and writes exact zeros; fed noise again it wakes on that
 * block and renders what a phaser built with `sleep: false` renders, to within
 * the floor, so the wake is continuous and loses nothing, also when its controls
 * or its switch moved while it slept (windsor#802); and a render that never
 * goes silent is the same bits with the sleep or without it.
 */
import { describe, expect, it } from 'vitest';
import {
  join,
  largestDifference,
  noise,
  peakFrom,
  QUANTUM,
  runBlocks,
  silence,
  type SleepingProcessor,
} from '../__fixtures__/insertSleepRun';
import { runWithChanges, type BlockChanges } from '../__fixtures__/insertSleepChanges';
import { loadPhaser, phaserParams } from '../__fixtures__/phaserHarness';
import type { PhaserSpec } from './phaserSpec';
import { PHASER_SLEEP } from './phaserConstants';

const RATE = 48000;
const LOUD = 40;
const TAIL_BLOCKS = Math.ceil((PHASER_SLEEP.tailSeconds * RATE) / QUANTUM);
/**
 * A wake after controls moved asleep, against a phaser that never slept: asleep, the controls,
 * the switch's fade, the follower and the sweep's phase step a sample at a time as awake, so
 * only the state zeroed under the floor at the sleep differs.
 */
const GLIDE_BOUND = 1e-7;

const phaser = (spec: Partial<PhaserSpec>, sleep = true): SleepingProcessor =>
  loadPhaser(RATE, phaserParams(spec), { sleep }) as unknown as SleepingProcessor;

/** The slowest settle: the all-passes at the 20 Hz floor, the feedback at its most, cut at 20 Hz. */
const SLOWEST: Partial<PhaserSpec>[] = [0.9, -0.9].map((feedback) => ({
  center: 80,
  depth: 4,
  rate: 0.01,
  envelope: -4,
  feedback,
  feedbackCut: 20,
  mix: 1,
}));

describe('the phaser asleep', () => {
  it.each([{}, ...SLOWEST])('sleeps within its tail after noise and writes zeros: %o', (spec) => {
    const blocks = LOUD + TAIL_BLOCKS + 8;
    const run = runBlocks(phaser(spec), phaserParams(spec), noise(LOUD), blocks);
    const slept = run.asleep.indexOf(true);
    expect(slept).toBeGreaterThanOrEqual(LOUD);
    expect(slept - LOUD).toBeLessThan(TAIL_BLOCKS);
    expect(run.asleep.slice(slept).every(Boolean)).toBe(true);
    expect(peakFrom(run, slept + 1)).toBe(0);
  });

  it.each([{}, ...SLOWEST])(
    'wakes on the first loud block, continuous with no sleep: %o',
    (spec) => {
      const quiet = TAIL_BLOCKS + 16;
      const source = join(noise(LOUD), silence(quiet), noise(LOUD, 7));
      const blocks = LOUD + quiet + LOUD;
      const sleeping = runBlocks(phaser(spec), phaserParams(spec), source, blocks);
      const awake = runBlocks(phaser(spec, false), phaserParams(spec), source, blocks);
      expect(sleeping.asleep[LOUD + quiet - 1]).toBe(true);
      expect(sleeping.asleep[LOUD + quiet]).toBe(false);
      expect(awake.asleep.includes(true)).toBe(false);
      expect(largestDifference(sleeping, awake)).toBeLessThan(PHASER_SLEEP.stateFloor);
    },
  );

  describe('through control changes made asleep (windsor#802)', () => {
    const quiet = TAIL_BLOCKS + 16,
      wake = LOUD + quiet;
    /** The changes, each on a block the phaser enters asleep; the wake comes mid-glide. */
    function expectGlide(spec: Partial<PhaserSpec>, changes: BlockChanges): void {
      const source = join(noise(LOUD), silence(quiet), noise(LOUD, 7));
      const blocks = wake + LOUD;
      const sleeping = runWithChanges(phaser(spec), phaserParams(spec), source, blocks, changes);
      const awake = runWithChanges(
        phaser(spec, false),
        phaserParams(spec),
        source,
        blocks,
        changes,
      );
      for (const b of changes.keys()) expect(sleeping.asleep[b - 1], `asleep into ${b}`).toBe(true);
      expect(sleeping.asleep[wake]).toBe(false);
      expect(largestDifference(sleeping, awake)).toBeLessThan(GLIDE_BOUND);
    }

    it.each([{}, ...SLOWEST])(
      'wakes mid-glide on the render of a phaser that never slept: %o',
      (spec) => {
        expectGlide(
          spec,
          new Map([
            [wake - 40, { rate: 6, stereo: 120 }],
            [wake - 3, { center: 2500, depth: 3.5, feedback: -0.6, feedbackCut: 900 }],
            [wake - 2, { envelope: 2.5, bassKeep: 0.7, mix: 0.9, rate: 0.5 }],
          ]),
        );
      },
    );

    it('fades a bypass toggled asleep as awake into a full-scale block', () => {
      expectGlide({}, new Map([[wake - 1, { enabled: 0 }]]));
      expectGlide(
        {},
        new Map([
          [wake - 40, { enabled: 0 }],
          [wake - 1, { enabled: 1 }],
        ]),
      );
    });
  });

  it('renders a signal that never goes silent to the same bits as without the sleep', () => {
    const source = noise(200, 3);
    const sleeping = runBlocks(phaser({}), phaserParams(), source, 200);
    const awake = runBlocks(phaser({}, false), phaserParams(), source, 200);
    expect(sleeping.left).toEqual(awake.left);
    expect(sleeping.right).toEqual(awake.right);
    expect(sleeping.asleep.includes(true)).toBe(false);
  });
});
