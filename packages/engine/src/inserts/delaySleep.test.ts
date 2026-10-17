/**
 * The Dub delay's sleep (windsor#793, `DELAY_SLEEP`), on the shipped bundle:
 * a delay whose lines hold nothing sleeps on its first silent block; fed
 * silence after full-scale noise it sleeps once no line write has crossed the
 * output floor for the line's whole length, which bounds the tail at the
 * repeats' fall to the floor (`log(floor) / log(loop gain)` repeats of the
 * longer time) plus `maxSeconds`, and writes exact zeros; a delay that holds
 * its repeats up (Sustain, or Feedback times the filter's peak at or past
 * unity) never sleeps, even on a seed
 * under the output floor that its loop grows; a fresh delay seeded under the
 * floor waits the line's length before it sleeps; fed noise again it wakes
 * on that block and renders what a delay built with `sleep: false` renders,
 * to within the floor, also when its times changed while it slept (the glide
 * moves asleep as awake); and a render that never goes silent is the same
 * bits with the sleep or without it.
 */
import { describe, expect, it } from 'vitest';
import { delayParams, loadDelay } from '../__fixtures__/delayHarness';
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
import { DELAY_DSP, DELAY_SLEEP } from './delayConstants';
import type { DelaySpec } from './delaySpec';

const RATE = 48000;
const LOUD = 40;
const LINE_BLOCKS = (DELAY_DSP.maxSeconds * RATE) / QUANTUM;

const delay = (spec: Partial<DelaySpec>, sleep = true): SleepingProcessor =>
  loadDelay(RATE, delayParams(spec), { sleep }) as unknown as SleepingProcessor;

/** The tail's bound: the repeats of the longer time down to the floor, then the line's length. */
function tailBlocks(spec: Partial<DelaySpec>): number {
  const params = delayParams(spec);
  const longest = Math.max(params.leftMs![0]!, params.rightMs![0]!) / DELAY_DSP.milliseconds;
  // The loop's largest gain: Feedback times the filter's peak at its Resonance (`delayDsp.ts`'s `hold`).
  const gain = 10 ** (params.resonance![0]! / 20);
  const peak = gain > Math.SQRT1_2 ? gain / Math.sqrt(1 - 1 / (4 * gain * gain)) : 1;
  const loop = params.feedback![0]! * peak;
  const repeats = Math.log(DELAY_SLEEP.outputFloor) / Math.log(loop) + 1;
  return Math.ceil(((repeats * longest + DELAY_DSP.maxSeconds) * RATE) / QUANTUM);
}

const SPECS: Partial<DelaySpec>[] = [
  {},
  { mode: 'ping-pong', feedback: 0.8, resonance: 0, cross: 1, drive: 12, wave: 'random', wow: 0.5 },
];

describe('the Dub delay asleep', () => {
  it('sleeps on its first silent block while its lines hold nothing', () => {
    const run = runBlocks(delay({}), delayParams(), silence(4), 4);
    expect(run.asleep).toEqual([true, true, true, true]);
    expect(peakFrom(run, 0)).toBe(0);
  });

  it.each(SPECS)('sleeps within its tail after noise and writes zeros: %o', (spec) => {
    const tail = tailBlocks(spec);
    const run = runBlocks(delay(spec), delayParams(spec), noise(LOUD), LOUD + tail + 8);
    const slept = run.asleep.indexOf(true);
    expect(slept - LOUD).toBeGreaterThan(LINE_BLOCKS);
    expect(slept - LOUD).toBeLessThan(tail);
    expect(run.asleep.slice(slept).every(Boolean)).toBe(true);
    expect(peakFrom(run, slept)).toBe(0);
  });

  it.each<Partial<DelaySpec>>([{ feedback: 1 }, { feedback: 0.7, resonance: 9 }])(
    'never sleeps while its loop holds the repeats up: %o',
    (spec) => {
      const run = runBlocks(delay(spec), delayParams(spec), noise(LOUD), LOUD + 2 * LINE_BLOCKS);
      expect(run.asleep.includes(true)).toBe(false);
    },
  );

  it('never sleeps while Sustain holds what the loop carried, and sleeps once released', () => {
    const held = delayParams({ sustain: true });
    const run = runLegs(delay({}), [
      { params: delayParams(), source: noise(LOUD), blocks: LOUD },
      { params: held, source: silence(1), blocks: 2 * LINE_BLOCKS },
    ]);
    expect(run.asleep.includes(true)).toBe(false);
    expect(peakFrom(run, LOUD + 2 * LINE_BLOCKS - 1)).toBeGreaterThan(0.01);
    const empty = runBlocks(delay({ sustain: true }), held, noise(LOUD), LOUD + 4);
    // Sustain shuts the input out, so lines that never took any have nothing to hold.
    expect(empty.asleep.slice(LOUD)).toEqual([true, true, true, true]);
  });

  it('never sleeps on a seed under the floor that its feedback grows', () => {
    const spec = {
      leftSync: false,
      rightSync: false,
      leftMs: 1,
      rightMs: 1,
      feedback: 1,
      resonance: 12,
    };
    const blocks = 400;
    const source = silence(blocks);
    const seed = (DELAY_SLEEP.inputFloor + DELAY_SLEEP.outputFloor) / 2;
    source[0]![0] = source[1]![0] = seed;
    const sleeping = runBlocks(delay(spec), delayParams(spec), source, blocks);
    const awake = runBlocks(delay(spec, false), delayParams(spec), source, blocks);
    expect(peakFrom(awake, 0)).toBeGreaterThan(0.1);
    expect(sleeping.asleep.includes(true)).toBe(false);
    expect(sleeping.left).toEqual(awake.left);
    expect(sleeping.right).toEqual(awake.right);
  });

  it('waits a line of quiet writes after a seed under the floor before it sleeps', () => {
    const source = silence(1);
    source[0]![0] = source[1]![0] = DELAY_SLEEP.outputFloor / 2;
    const run = runBlocks(delay({}), delayParams(), source, LINE_BLOCKS + 4);
    expect(run.asleep.indexOf(true)).toBeGreaterThanOrEqual(LINE_BLOCKS);
  });

  it.each(SPECS)(
    'wakes on the first loud block, continuous with no sleep: %o',
    (spec) => {
      const quiet = tailBlocks(spec) + 16;
      const source = join(noise(LOUD), silence(quiet), noise(LOUD, 7));
      const blocks = LOUD + quiet + LOUD;
      const sleeping = runBlocks(delay(spec), delayParams(spec), source, blocks);
      const awake = runBlocks(delay(spec, false), delayParams(spec), source, blocks);
      expect(sleeping.asleep[LOUD + quiet - 1]).toBe(true);
      expect(sleeping.asleep[LOUD + quiet]).toBe(false);
      expect(awake.asleep.includes(true)).toBe(false);
      expect(largestDifference(sleeping, awake)).toBeLessThan(DELAY_SLEEP.outputFloor);
    },
    20_000,
  );

  it('glides its times while asleep as it would awake', () => {
    const short = delayParams({ leftSync: false, rightSync: false, leftMs: 1, rightMs: 1 });
    const impulse = silence(1);
    impulse[0]![0] = impulse[1]![0] = 1;
    const legs = (): Parameters<typeof runLegs>[1] => [
      { params: delayParams(), source: silence(1), blocks: 1 },
      { params: short, source: silence(1), blocks: 1 },
      { params: short, source: impulse, blocks: 8 },
    ];
    const sleeping = runLegs(delay({}), legs());
    const awake = runLegs(delay({}, false), legs());
    expect(sleeping.asleep.slice(0, 2)).toEqual([true, true]);
    expect(peakFrom(awake, 2)).toBeGreaterThan(0.1);
    expect(largestDifference(sleeping, awake)).toBeLessThan(DELAY_SLEEP.outputFloor);
  });

  it('renders a signal that never goes silent to the same bits as without the sleep', () => {
    const source = noise(400, 3);
    const sleeping = runBlocks(delay({}), delayParams(), source, 400);
    const awake = runBlocks(delay({}, false), delayParams(), source, 400);
    expect(sleeping.left).toEqual(awake.left);
    expect(sleeping.right).toEqual(awake.right);
    expect(sleeping.asleep.includes(true)).toBe(false);
  });
});
