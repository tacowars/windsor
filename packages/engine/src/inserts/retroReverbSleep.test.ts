/**
 * The Retro reverb's sleep (windsor#793, `RETRO_REVERB_SLEEP`), on the
 * shipped bundle: fed silence after full-scale noise it sleeps once its wet
 * tail has stayed under the output floor for `spanSeconds`, which bounds the
 * tail at the pre-delay, `(140 / 60) × Decay` (an RT60 falls 140 dB, to the
 * floor, in 7/3 of itself) and `spanSeconds`, and writes exact zeros; fed noise again it wakes
 * on that block and renders what a reverb built with `sleep: false` renders,
 * to within the floor, so the wake is continuous and loses nothing; and a
 * render that never goes silent is the same bits with the sleep or without it.
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
import { loadRetro, retroParams } from '../__fixtures__/retroReverbHarness';
import type { RetroReverbSpec } from './retroReverbSpec';
import { RETRO_REVERB_SLEEP } from './retroReverbConstants';

const RATE = 48000;
const LOUD = 40;
/** Seconds an RT60 takes to fall from full scale to the output floor, per second of Decay. */
const FLOOR_PER_RT60 = 140 / 60;

const retro = (spec: Partial<RetroReverbSpec>, sleep = true): SleepingProcessor =>
  loadRetro(RATE, retroParams(spec), { sleep }) as unknown as SleepingProcessor;
/** The tail's bound: the pre-delay, the decay to the floor, then the span. */
const tailBlocks = ({ decay = 1.4, preDelay = 0 }: Partial<RetroReverbSpec>): number =>
  Math.ceil(
    ((preDelay + FLOOR_PER_RT60 * decay + RETRO_REVERB_SLEEP.spanSeconds) * RATE) / QUANTUM,
  );

/** Clean (Character 0) so the converters' quantiser cannot turn the floor into a step. */
const SPECS: Partial<RetroReverbSpec>[] = [
  { character: 0 },
  { character: 0, decay: 1, size: 10, preDelay: 0.25, early: 1, density: 1, driftDepth: 1 },
  { character: 0, mode: 'gated', duration: 0.6, preDelay: 0.25 },
  { character: 0, mode: 'reverse', duration: 0.6, converter: 'ranging' },
];

describe('the Retro reverb asleep', () => {
  it.each(SPECS)('sleeps within its tail after noise and writes zeros: %o', (spec) => {
    const tail = tailBlocks(spec);
    const run = runBlocks(retro(spec), retroParams(spec), noise(LOUD), LOUD + tail + 8);
    const slept = run.asleep.indexOf(true);
    expect(slept - LOUD).toBeGreaterThan((RETRO_REVERB_SLEEP.spanSeconds * RATE) / QUANTUM);
    expect(slept - LOUD).toBeLessThan(tail);
    expect(run.asleep.slice(slept).every(Boolean)).toBe(true);
    expect(peakFrom(run, slept)).toBe(0);
  });

  it.each([...SPECS, {}])(
    'wakes on the first loud block, continuous with no sleep: %o',
    (spec) => {
      const quiet = tailBlocks(spec) + 16;
      const source = join(noise(LOUD), silence(quiet), noise(LOUD, 7));
      const blocks = LOUD + quiet + LOUD;
      const sleeping = runBlocks(retro(spec), retroParams(spec), source, blocks);
      const awake = runBlocks(retro(spec, false), retroParams(spec), source, blocks);
      expect(sleeping.asleep[LOUD + quiet - 1]).toBe(true);
      expect(sleeping.asleep[LOUD + quiet]).toBe(false);
      expect(awake.asleep.includes(true)).toBe(false);
      expect(largestDifference(sleeping, awake)).toBeLessThan(RETRO_REVERB_SLEEP.outputFloor);
    },
    20_000,
  );

  it('renders a signal that never goes silent to the same bits as without the sleep', () => {
    const source = noise(400, 3);
    const sleeping = runBlocks(retro({}), retroParams(), source, 400);
    const awake = runBlocks(retro({}, false), retroParams(), source, 400);
    expect(sleeping.left).toEqual(awake.left);
    expect(sleeping.right).toEqual(awake.right);
    expect(sleeping.asleep.includes(true)).toBe(false);
  });
});
