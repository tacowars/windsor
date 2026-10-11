/**
 * bloom's wet-path slot in the worklet (`worklet/bloom/bloomOutput.ts`, the
 * a-rate `split` param), through the shipped bundle with the processor's
 * three outputs (`BLOOM_SLOT`): output 0 is bloom's output, output 1 the
 * layer after Amount (stereo, after Spread) and output 2 the gain the child's
 * return takes. The host's sum is modelled sample by sample,
 * `out0 + fade · child(out1) · out2`, with a fake child that passes, scales or
 * mutes the layer (`__fixtures__/bloomSlotHarness.ts`).
 *
 * Pinned here (record `2026-10-11-bloom-insert`, E2): split 0 leaves output
 * 0 bit for bit as without the outputs; output 2 is Mix's wet share × the
 * switch and never carries split, so the child's fade is the return's only
 * fade; split acts sample by sample, so with the fade on the same ramp an
 * identity child gives back the output without one through a crossing and a
 * reversal; and every corner of Mix, Amount, the switch and Freeze.
 */
// reads-by-path: packages/engine/src/worklet/generated/**
import { describe, expect, it } from 'vitest';
import { mixed, noise, tone } from '../__fixtures__/bloomHarness';
import {
  hostSum,
  renderPlain,
  renderSlot,
  sumError,
  type SlotRender,
} from '../__fixtures__/bloomSlotHarness';
import type { BloomSpec } from './bloomSpec';
import { INSERT_FADE_SECONDS, INSERT_SWITCH_FADE_S } from './insertConstants';

const RATE = 48000;
const QUANTUM = 128;
const SOURCE = mixed(tone(220, 0.2, RATE), tone(330, 0.1, RATE), noise(0.02));
/** Mix 75 %: the dry share is half the input, Mix's wet share 1. Spread moves the layer off mono. */
const SPEC: Partial<BloomSpec> = { mix: 0.75, amount: 0.8, spread: 0.6 };
const FRAMES = Math.round(1.2 * RATE);
const FADE_FRAMES = Math.round(INSERT_FADE_SECONDS * RATE);
/** An identity child's sum against the output without one: float32 rounding of each node. */
const SUM_TOLERANCE = 1e-5;
/** Where the crossing starts: off a block boundary, as a param's ramp is. */
const ON = Math.round(0.6 * RATE) + 37;

/** A linear ramp from `from` to `to` over one fade window from frame `at`, held either side. */
const ramp =
  (at: number, from: number, to: number) =>
  (frame: number): number =>
    frame <= at
      ? from
      : frame >= at + FADE_FRAMES
        ? to
        : from + ((to - from) * (frame - at)) / FADE_FRAMES;

/** Arrival at ON, then a departure halfway through its window: the reversal turns round where it is. */
const reversed = (frame: number): number => {
  const back = ON + FADE_FRAMES / 2;
  return frame < back ? ramp(ON, 0, 1)(frame) : ramp(back, 0.5, 0)(frame);
};

const render = (spec: Partial<BloomSpec>, split: (frame: number) => number): SlotRender =>
  renderSlot(spec, { rate: RATE, frames: FRAMES, source: SOURCE, split });

const peakOf = (data: Float32Array, from = 0, to = data.length): number => {
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(data[i]!));
  return peak;
};

describe('the slot in the worklet', () => {
  const none = render(SPEC, () => 0);
  const routed = render(SPEC, () => 1);

  it('at split 0, output 0 is bloom without the slot, bit for bit, whether the param is there or not', () => {
    const plain = renderPlain(SPEC, { rate: RATE, frames: FRAMES, source: SOURCE });
    const absent = renderSlot(SPEC, { rate: RATE, frames: FRAMES, source: SOURCE });
    for (const out of [none, absent]) {
      expect(out.left).toEqual(plain.left);
      expect(out.right).toEqual(plain.right);
    }
    // The layer is there, on output 1, stereo after Spread; the return's gain is Mix's wet share.
    expect(peakOf(none.sendLeft)).toBeGreaterThan(0.01);
    expect(none.sendLeft).not.toEqual(none.sendRight);
    expect(none.gain.every((g) => g === 1)).toBe(true);
  });

  it('output 2 is Mix’s wet share × the switch, never × split; at split 1 output 0 is the dry share alone', () => {
    for (let i = 0; i < FRAMES; i++) {
      // Mix 75 %: dry = 2 (1 − Mix) = 1/2, at the switch fully on.
      const x = routed.input[i]!;
      expect(routed.left[i]).toBe(Math.fround(x + (0.5 * x - x)));
    }
    expect(routed.gain).toEqual(none.gain);
    const crossing = render(SPEC, ramp(ON, 0, 1));
    expect(crossing.gain).toEqual(none.gain);
    // Mix 25 %: the wet share is 2 Mix.
    const quarter = render({ ...SPEC, mix: 0.25 }, () => 1);
    expect(quarter.gain.every((g) => g === Math.fround(0.5))).toBe(true);
  });

  it('an identity child at full fade is the output without one', () => {
    expect(peakOf(routed.sendLeft)).toBeGreaterThan(0.01);
    expect(sumError(routed, none, () => 1)).toBeLessThan(SUM_TOLERANCE);
  });

  it('takes split sample by sample: with the fade on its ramp, the sum is the output through a crossing and a reversal', () => {
    for (const split of [ramp(ON, 0, 1), ramp(ON, 1, 0), reversed]) {
      const crossing = render(SPEC, split);
      expect(crossing.split[ON + FADE_FRAMES / 2]).toBeGreaterThan(0.1);
      expect(sumError(crossing, none, (i) => crossing.split[i]!)).toBeLessThan(SUM_TOLERANCE);
    }
    // Landed back at 0, output 0 is bloom without the slot again, bit for bit.
    const back = render(SPEC, reversed);
    const landed = ON + 2 * FADE_FRAMES;
    expect(back.left.subarray(landed)).toEqual(none.left.subarray(landed));
    expect(back.right.subarray(landed)).toEqual(none.right.subarray(landed));
    expect(back.left.subarray(0, ON)).toEqual(none.left.subarray(0, ON));
  });

  it('with a child that mutes the layer, the internal wet is (1 − split) of it at every sample', () => {
    const crossing = render(SPEC, ramp(ON, 0, 1));
    let worst = 0,
      checked = 0;
    for (let i = ON; i <= ON + FADE_FRAMES; i++) {
      const wet = none.left[i]! - routed.left[i]!;
      if (Math.abs(wet) < 0.01) continue;
      checked++;
      const [muted] = hostSum(crossing, i, crossing.split[i]!, 0);
      worst = Math.max(worst, Math.abs((muted - routed.left[i]!) / wet - (1 - crossing.split[i]!)));
    }
    expect(checked).toBeGreaterThan(FADE_FRAMES / 2);
    expect(worst).toBeLessThan(1e-4);
  });
});

describe('the corners, with a child', () => {
  const CHILDREN = [1, 0, 3];

  it.each([{ mix: 0 }, { enabled: false }])(
    'at %o output 0 is the input and output 2 is 0, so any child is silent: the input to the bit',
    (corner) => {
      const out = render({ ...SPEC, ...corner }, ramp(ON, 0, 1));
      expect(out.left).toEqual(out.input);
      expect(peakOf(out.gain)).toBe(0);
      for (const child of CHILDREN)
        for (let i = 0; i < FRAMES; i += 7) expect(hostSum(out, i, 1, child)[0]).toBe(out.input[i]);
    },
  );

  it('at Amount 0 output 1 is silent, so any child adds nothing', () => {
    const out = render({ ...SPEC, amount: 0 }, ramp(ON, 0, 1));
    const without = render({ ...SPEC, amount: 0 }, () => 0);
    expect(peakOf(out.sendLeft)).toBe(0);
    expect(out.left).toEqual(without.left);
    for (const child of CHILDREN)
      for (let i = 0; i < FRAMES; i += 7) expect(hostSum(out, i, 1, child)[0]).toBe(out.left[i]);
  });

  it.each([{ mix: 0.5 }, { mix: 1 }, { amount: 1 }, { amount: 1, mix: 1, spread: 0 }])(
    'at %o an identity child sums to the output without one through a crossing and a reversal',
    (corner) => {
      const spec = { ...SPEC, ...corner };
      const without = render(spec, () => 0);
      for (const split of [ramp(ON, 0, 1), reversed]) {
        const out = render(spec, split);
        expect(sumError(out, without, (i) => out.split[i]!)).toBeLessThan(SUM_TOLERANCE);
      }
    },
  );

  it('with Freeze on mid-render the sum holds, and the frozen drone reaches the child', () => {
    const freezeAt = ON - 0.2 * RATE;
    const onBlock = (frame: number, params: Record<string, Float32Array>): void => {
      params.freeze![0] = frame >= freezeAt ? 1 : 0;
    };
    const options = { rate: RATE, frames: FRAMES, source: SOURCE, onBlock };
    const without = renderSlot(SPEC, { ...options, split: () => 0 });
    const out = renderSlot(SPEC, { ...options, split: reversed });
    expect(peakOf(out.sendLeft, ON, ON + FADE_FRAMES)).toBeGreaterThan(0.01);
    expect(sumError(out, without, (i) => out.split[i]!)).toBeLessThan(SUM_TOLERANCE);
  });

  it('switched off mid-crossing, output 0 and the sum are the input once the switch has faded', () => {
    const offAt = ON + QUANTUM;
    const onBlock = (frame: number, params: Record<string, Float32Array>): void => {
      params.enabled![0] = frame >= offAt ? 0 : 1;
    };
    const out = renderSlot(SPEC, {
      rate: RATE,
      frames: FRAMES,
      source: SOURCE,
      split: ramp(ON, 0, 1),
      onBlock,
    });
    // The switch's own fade, from the first block that reads off, and the block after it.
    const quiet = offAt + Math.ceil(INSERT_SWITCH_FADE_S * RATE) + 2 * QUANTUM;
    expect(out.left.subarray(quiet)).toEqual(out.input.subarray(quiet));
    expect(peakOf(out.gain, quiet)).toBe(0);
    for (let i = quiet; i < FRAMES; i += 7) expect(hostSum(out, i, 1)[0]).toBe(out.input[i]);
  });
});
