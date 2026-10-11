/**
 * bloom's wet-path slot in the worklet (`worklet/bloom/bloomOutput.ts`, the
 * `split` param), through the shipped bundle with the processor's three
 * outputs (`BLOOM_SLOT`): output 0 is bloom's output, output 1 the layer after
 * Amount (stereo, after Spread) and output 2 the gain the child's return
 * takes. A host's wet path is modelled sample by sample:
 * `out0 + child(out1) · out2`, with a fake child that passes or mutes the
 * layer.
 *
 * Pinned here: split 0 leaves output 0 bit for bit as without the outputs,
 * and output 2 silent; at split 1 output 0 is the dry share alone and output
 * 2 is Mix's wet share × the switch; an identity child gives back the output
 * without one, through the crossing too; and the crossing is linear over
 * `INSERT_FADE_SECONDS` and lands exactly, both ways.
 */
// reads-by-path: packages/engine/src/worklet/generated/**
import { describe, expect, it } from 'vitest';
import { bloomParams, loadBloom, mixed, noise, tone } from '../__fixtures__/bloomHarness';
import type { BloomSource } from '../__fixtures__/bloomHarness';
import type { BloomSpec } from './bloomSpec';
import { BLOOM_SLOT } from './bloomConstants';
import { INSERT_FADE_SECONDS } from './insertConstants';

const RATE = 48000;
const QUANTUM = 128;
const SOURCE = mixed(tone(220, 0.2, RATE), tone(330, 0.1, RATE), noise(0.02));
/** Mix 75 %: the dry share is half the input, Mix's wet share 1. Spread moves the layer off mono. */
const SPEC: Partial<BloomSpec> = { mix: 0.75, amount: 0.8, spread: 0.6 };
const SECONDS = 1.2;
const FADE_FRAMES = Math.round(INSERT_FADE_SECONDS * RATE);
/** An identity child's sum against the output without one: float32 rounding of each output. */
const SUM_TOLERANCE = 1e-5;

interface SplitRender {
  left: Float32Array;
  right: Float32Array;
  sendLeft: Float32Array;
  sendRight: Float32Array;
  gain: Float32Array;
  input: Float32Array;
}

/**
 * `frames` of `source` through a fresh processor with the stage's three
 * outputs; `split(frame)` is the param's value for the block at `frame`.
 */
function render(
  spec: Partial<BloomSpec>,
  frames: number,
  split: (frame: number) => number,
  source: BloomSource = SOURCE,
): SplitRender {
  const params = bloomParams(spec);
  params[BLOOM_SLOT.splitParam] = new Float32Array([split(0)]);
  const processor = loadBloom(RATE, params);
  const out: SplitRender = {
    left: new Float32Array(frames),
    right: new Float32Array(frames),
    sendLeft: new Float32Array(frames),
    sendRight: new Float32Array(frames),
    gain: new Float32Array(frames),
    input: new Float32Array(frames),
  };
  const input = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
  const outputs = [
    [new Float32Array(QUANTUM), new Float32Array(QUANTUM)],
    [new Float32Array(QUANTUM), new Float32Array(QUANTUM)],
    [new Float32Array(QUANTUM)],
  ];
  for (let frame = 0; frame < frames; frame += QUANTUM) {
    params[BLOOM_SLOT.splitParam]![0] = split(frame);
    for (let i = 0; i < QUANTUM; i++) {
      input[0]![i] = source(frame + i, 0);
      input[1]![i] = source(frame + i, 1);
    }
    processor.process([input], outputs, params);
    const n = Math.min(QUANTUM, frames - frame);
    out.left.set(outputs[0]![0]!.subarray(0, n), frame);
    out.right.set(outputs[0]![1]!.subarray(0, n), frame);
    out.sendLeft.set(outputs[1]![0]!.subarray(0, n), frame);
    out.sendRight.set(outputs[1]![1]!.subarray(0, n), frame);
    out.gain.set(outputs[2]![0]!.subarray(0, n), frame);
    out.input.set(input[0]!.subarray(0, n), frame);
  }
  return out;
}

const frames = Math.round(SECONDS * RATE);
/** The block where the crossing starts, and where it goes back. */
const ON = Math.round((0.6 * RATE) / QUANTUM) * QUANTUM;
const OFF = ON + 16 * QUANTUM;

/** The stage's sum with a child that scales the layer by `child`. */
const through = (out: SplitRender, child: number, i: number): [number, number] => [
  out.left[i]! + child * out.sendLeft[i]! * out.gain[i]!,
  out.right[i]! + child * out.sendRight[i]! * out.gain[i]!,
];

/** The largest |a − b| over [from, to) of an identity child's sum against `reference`. */
function sumError(out: SplitRender, reference: SplitRender, from = 0, to = frames): number {
  let worst = 0;
  for (let i = from; i < to; i++) {
    const [l, r] = through(out, 1, i);
    worst = Math.max(worst, Math.abs(l - reference.left[i]!), Math.abs(r - reference.right[i]!));
  }
  return worst;
}

const peakOf = (data: Float32Array, from = 0, to = data.length): number => {
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(data[i]!));
  return peak;
};

describe('the slot in the worklet', () => {
  const none = render(SPEC, frames, () => 0);
  const routed = render(SPEC, frames, () => 1);

  it('at split 0, output 0 is bloom without the slot, bit for bit, and output 2 is silent', () => {
    const params = bloomParams(SPEC);
    const processor = loadBloom(RATE, params);
    const input = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    const output = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    const left = new Float32Array(frames),
      right = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += QUANTUM) {
      for (let i = 0; i < QUANTUM; i++) {
        input[0]![i] = SOURCE(frame + i, 0);
        input[1]![i] = SOURCE(frame + i, 1);
      }
      processor.process([input], [output], params);
      left.set(output[0]!.subarray(0, Math.min(QUANTUM, frames - frame)), frame);
      right.set(output[1]!.subarray(0, Math.min(QUANTUM, frames - frame)), frame);
    }
    expect(none.left).toEqual(left);
    expect(none.right).toEqual(right);
    expect(peakOf(none.gain)).toBe(0);
    // The layer is there, on output 1, stereo after Spread.
    expect(peakOf(none.sendLeft)).toBeGreaterThan(0.01);
    expect(none.sendLeft).not.toEqual(none.sendRight);
  });

  it('at split 1, output 0 is the dry share alone and output 2 is Mix’s wet share × the switch', () => {
    for (let i = 0; i < frames; i++) {
      // Mix 75 %: dry = 2 (1 − Mix) = 1/2, at the switch fully on.
      const x = routed.input[i]!;
      expect(routed.left[i]).toBe(Math.fround(x + (0.5 * x - x)));
    }
    expect(routed.gain.every((g) => g === 1)).toBe(true);
    // Mix 25 %: the wet share is 2 Mix.
    const quarter = render({ ...SPEC, mix: 0.25 }, 4 * QUANTUM, () => 1);
    expect(quarter.gain.every((g) => g === Math.fround(0.5))).toBe(true);
  });

  it('outputs 1 and 2 carry the layer after Amount: an identity child is the output without one', () => {
    expect(peakOf(routed.sendLeft)).toBeGreaterThan(0.01);
    expect(sumError(routed, none)).toBeLessThan(SUM_TOLERANCE);
  });

  it('crosses over the fade linearly, lands exactly both ways, and the sum stays the output', () => {
    const crossing = render(SPEC, frames, (f) => (f >= ON && f < OFF ? 1 : 0));
    // Rising: one step a sample from the block that reads 1, exactly 1 once landed.
    const step = 1 / FADE_FRAMES;
    for (let k = 0; k < FADE_FRAMES - 1; k++)
      expect(crossing.gain[ON + k]).toBeCloseTo((k + 1) * step, 6);
    const up = crossing.gain.subarray(ON, OFF).findIndex((g) => g === 1);
    expect(up).toBeGreaterThanOrEqual(FADE_FRAMES - 1);
    expect(up).toBeLessThanOrEqual(FADE_FRAMES);
    expect(crossing.gain.subarray(ON + up, OFF).every((g) => g === 1)).toBe(true);
    // Falling, and once landed at 0, output 0 is bloom without the slot again, bit for bit.
    const down = crossing.gain.subarray(OFF).findIndex((g) => g === 0);
    expect(down).toBeGreaterThanOrEqual(FADE_FRAMES - 1);
    expect(down).toBeLessThanOrEqual(FADE_FRAMES);
    expect(crossing.left.subarray(OFF + down)).toEqual(none.left.subarray(OFF + down));
    expect(crossing.right.subarray(OFF + down)).toEqual(none.right.subarray(OFF + down));
    expect(crossing.left.subarray(0, ON)).toEqual(none.left.subarray(0, ON));
    // Click-free: through the identity child the sum is the output, at every sample.
    expect(sumError(crossing, none)).toBeLessThan(SUM_TOLERANCE);
  });

  it('with a child that mutes the layer, the internal wet falls by (1 − split) through the crossing', () => {
    const crossing = render(SPEC, frames, (f) => (f >= ON ? 1 : 0));
    const dry = (i: number): number => routed.left[i]!;
    let worst = 0,
      checked = 0;
    for (let k = 0; k <= FADE_FRAMES; k++) {
      const i = ON + k,
        wet = none.left[i]! - dry(i);
      if (Math.abs(wet) < 0.01) continue;
      checked++;
      const [muted] = through(crossing, 0, i);
      worst = Math.max(worst, Math.abs((muted - dry(i)) / wet - (1 - crossing.gain[i]!)));
    }
    expect(checked).toBeGreaterThan(FADE_FRAMES / 2);
    expect(worst).toBeLessThan(1e-4);
  });

  it('the switch gates the return: fully off, output 0 is the input and output 2 is 0', () => {
    const off = render({ ...SPEC, enabled: false }, 8 * QUANTUM, () => 1);
    expect(off.left).toEqual(off.input);
    expect(peakOf(off.gain)).toBe(0);
    expect(peakOf(off.sendLeft)).toBe(0);
  });
});
