/**
 * The Wow and Flutter dials' square law (windsor#818): the curve's values, and the shipped
 * bundle's `TapeDsp` handing `TapeMotion` the curve's amounts for Wow and Flutter, split and
 * unsplit, while Dropouts keep `value / 100`.
 */
import { expect, it, vi } from 'vitest';
import { loadTape, tapeParams } from '../__fixtures__/tapeHarness';
import { TAPE_DSP } from './tapeConstants';
import { tapeMotionAmount } from './tapeMotionCurve';

vi.setConfig({ testTimeout: 30_000 });

interface MotionState {
  delay: number;
  wowAmount: number;
  flutterAmount: number;
  dropoutAmount: number;
}
interface DspState {
  motion: MotionState;
  tick(left: number, right: number): void;
  configure(params: Record<string, Float32Array>, frames: number): void;
}
function state(spec = {}): { params: Record<string, Float32Array>; dsp: DspState } {
  const params = tapeParams(spec);
  const processor = loadTape(48000, params) as unknown as { dsp: DspState };
  return { params, dsp: processor.dsp };
}

it('runs from 0 at dial 0 to 0.3 at dial 100, through 0.03 at about 31.6 and 0.05 at about 40.8', () => {
  expect(tapeMotionAmount(0)).toBe(0);
  expect(tapeMotionAmount(100)).toBe(TAPE_DSP.motionMax);
  expect(TAPE_DSP.motionMax).toBe(0.3);
  expect(tapeMotionAmount(100 * Math.sqrt(0.1))).toBeCloseTo(0.03, 12);
  expect(tapeMotionAmount(31.6)).toBeCloseTo(0.03, 4);
  expect(tapeMotionAmount(40.8)).toBeCloseTo(0.05, 3);
  // The old linear dial's 30 % is the new dial's top.
  expect(tapeMotionAmount(100)).toBe(30 / TAPE_DSP.percent);
  let previous = -1;
  for (let dial = 0; dial <= 100; dial += 0.25) {
    const amount = tapeMotionAmount(dial);
    expect(amount).toBeGreaterThan(previous);
    previous = amount;
  }
});

it('drives Wear 30 unsplit at the curve’s amount for Wow and Flutter, and its dropouts at 0.3', () => {
  const { dsp } = state({ wear: 30 });
  dsp.tick(0, 0);
  expect(dsp.motion.wowAmount).toBe(tapeMotionAmount(30));
  expect(dsp.motion.wowAmount).toBeCloseTo(0.027, 12);
  expect(dsp.motion.flutterAmount).toBe(dsp.motion.wowAmount);
  expect(dsp.motion.dropoutAmount).toBe(0.3);
});

it('drives split Wow and Flutter on the curve and Dropouts linearly', () => {
  const { dsp } = state({ split: true, wow: 41, flutter: 58, dropouts: 30, wear: 90 });
  dsp.tick(0, 0);
  expect(dsp.motion.wowAmount).toBe(tapeMotionAmount(41));
  expect(dsp.motion.flutterAmount).toBe(tapeMotionAmount(58));
  expect(dsp.motion.dropoutAmount).toBe(0.3);
});

it('gives no delay motion with Wow and Flutter at 0, split or with Wear at 0', () => {
  for (const spec of [{ split: true, dropouts: 100 }, { wear: 0 }]) {
    const { dsp } = state({ ...spec, seed: 7 });
    for (let i = 0; i < 48000 * 3; i++) {
      dsp.tick(0, 0);
      expect(dsp.motion.delay).toBe(0);
    }
  }
});

it('carries a gliding Wear into the split dials with no jump in the motion amounts', () => {
  const { dsp, params } = state({ wear: 20 });
  params.wear![0] = 80;
  dsp.configure(params, 128);
  for (let i = 0; i < 200; i++) dsp.tick(0, 0);
  const before = { ...dsp.motion };
  // Mid-glide, the dials split toward their own targets.
  dsp.configure(tapeParams({ wear: 80, split: true, wow: 10, flutter: 90, dropouts: 50 }), 128);
  dsp.tick(0, 0);
  const k = 1 - Math.exp(-1 / (48000 * TAPE_DSP.smoothSeconds));
  // One sample's glide at most: the amounts move on from Wear's, never jump.
  const step = tapeMotionAmount(90) * k * 2;
  expect(Math.abs(dsp.motion.wowAmount - before.wowAmount)).toBeLessThan(step);
  expect(Math.abs(dsp.motion.flutterAmount - before.flutterAmount)).toBeLessThan(step);
  expect(Math.abs(dsp.motion.dropoutAmount - before.dropoutAmount)).toBeLessThan(k);
});
