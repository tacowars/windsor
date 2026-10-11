/**
 * bloom's wet-path slot under Node (record `2026-10-11-bloom-insert`, E2): the
 * shipped processor with the stage's three outputs (`BLOOM_SLOT`) and its
 * a-rate `split` given sample by sample, and the host's sum modelled as the
 * stage wires it, `out0 + fade · child(out1) · out2`. The fake context can't
 * run a worklet in a graph or a param's ramp, so a test reads the stage's
 * schedules (`FakeParam.valueAt`) and hands them to this render.
 */
// reads-by-path: packages/engine/src/worklet/generated/**
import { BLOOM_SLOT } from '../inserts/bloomConstants';
import type { BloomSpec } from '../inserts/bloomSpec';
import { bloomParams, loadBloom } from './bloomHarness';
import type { BloomProcessorLike, BloomSource } from './bloomHarness';
import { BLOCK } from './fakeAudioNodes';

/** One render's outputs, frame by frame, and the input's left channel. */
export interface SlotRender {
  /** Output 0. */
  left: Float32Array;
  right: Float32Array;
  /** Output 1: the layer after Amount. */
  sendLeft: Float32Array;
  sendRight: Float32Array;
  /** Output 2: the gain the return takes. */
  gain: Float32Array;
  /** The `split` each frame was rendered with. */
  split: Float32Array;
  input: Float32Array;
}

export interface SlotRenderOptions {
  readonly rate: number;
  readonly frames: number;
  readonly source: BloomSource;
  /** `split` at `frame`, as the param's a-rate values carry it. Absent: the param is left out. */
  readonly split?: (frame: number) => number;
  /** Called before each block; may change the params. */
  readonly onBlock?: (frame: number, params: Record<string, Float32Array>) => void;
}

/** A fresh processor with the stage's three outputs, rendering `options.frames` of `options.source`. */
export function renderSlot(spec: Partial<BloomSpec>, options: SlotRenderOptions): SlotRender {
  const { rate, frames, source, split, onBlock } = options;
  const params = bloomParams(spec);
  const splits = new Float32Array(BLOCK);
  if (split) params[BLOOM_SLOT.splitParam] = splits;
  const processor: BloomProcessorLike = loadBloom(rate, params);
  const out: SlotRender = {
    left: new Float32Array(frames),
    right: new Float32Array(frames),
    sendLeft: new Float32Array(frames),
    sendRight: new Float32Array(frames),
    gain: new Float32Array(frames),
    split: new Float32Array(frames),
    input: new Float32Array(frames),
  };
  const input = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const outputs = [
    [new Float32Array(BLOCK), new Float32Array(BLOCK)],
    [new Float32Array(BLOCK), new Float32Array(BLOCK)],
    [new Float32Array(BLOCK)],
  ];
  for (let frame = 0; frame < frames; frame += BLOCK) {
    onBlock?.(frame, params);
    for (let i = 0; i < BLOCK; i++) {
      input[0]![i] = source(frame + i, 0);
      input[1]![i] = source(frame + i, 1);
      if (split) splits[i] = split(frame + i);
    }
    processor.process([input], outputs, params);
    const n = Math.min(BLOCK, frames - frame);
    out.left.set(outputs[0]![0]!.subarray(0, n), frame);
    out.right.set(outputs[0]![1]!.subarray(0, n), frame);
    out.sendLeft.set(outputs[1]![0]!.subarray(0, n), frame);
    out.sendRight.set(outputs[1]![1]!.subarray(0, n), frame);
    out.gain.set(outputs[2]![0]!.subarray(0, n), frame);
    out.split.set(splits.subarray(0, n), frame);
    out.input.set(input[0]!.subarray(0, n), frame);
  }
  return out;
}

/** `frames` of `source` through a fresh processor with output 0 alone and no `split`: bloom before the slot. */
export function renderPlain(spec: Partial<BloomSpec>, options: SlotRenderOptions): SlotRender {
  const { rate, frames, source, onBlock } = options;
  const params = bloomParams(spec);
  const processor = loadBloom(rate, params);
  const left = new Float32Array(frames),
    right = new Float32Array(frames);
  const input = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  for (let frame = 0; frame < frames; frame += BLOCK) {
    onBlock?.(frame, params);
    for (let i = 0; i < BLOCK; i++) {
      input[0]![i] = source(frame + i, 0);
      input[1]![i] = source(frame + i, 1);
    }
    processor.process([input], [output], params);
    const n = Math.min(BLOCK, frames - frame);
    left.set(output[0]!.subarray(0, n), frame);
    right.set(output[1]!.subarray(0, n), frame);
  }
  const none = new Float32Array(frames);
  return { left, right, sendLeft: none, sendRight: none, gain: none, split: none, input: none };
}

/**
 * The host's output at frame `i` with children that scale the layer by
 * `child` and whose fades come to `fade` in all: output 0 plus
 * (child · out1 · fade) · out2, in the graph's order and, as a graph sums,
 * in float32 at each node.
 */
export function hostSum(
  out: SlotRender,
  i: number,
  fade: number,
  child = 1,
): readonly [number, number] {
  const back = (send: number): number =>
    Math.fround(Math.fround(Math.fround(child * send) * fade) * out.gain[i]!);
  return [
    Math.fround(out.left[i]! + back(out.sendLeft[i]!)),
    Math.fround(out.right[i]! + back(out.sendRight[i]!)),
  ];
}

/** The largest |a − b| over [from, to) of the host's sum, fade `fade(i)`, against `reference`'s output 0. */
export function sumError(
  out: SlotRender,
  reference: SlotRender,
  fade: (i: number) => number,
  range: readonly [number, number] = [0, out.left.length],
): number {
  let worst = 0;
  for (let i = range[0]; i < range[1]; i++) {
    const [l, r] = hostSum(out, i, fade(i));
    worst = Math.max(worst, Math.abs(l - reference.left[i]!), Math.abs(r - reference.right[i]!));
  }
  return worst;
}
