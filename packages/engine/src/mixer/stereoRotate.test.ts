/**
 * The strip's pan is a rotation, and these tests would fail under
 * `StereoPannerNode` balance semantics: a balance law fed a stereo source
 * mutes one side at full pan, which halves the energy of a centred source and
 * deletes whatever lived only in the muted channel. A rotation keeps the total
 * energy and moves the centre.
 */
import { describe, expect, it } from 'vitest';

import { energy, rms, toneLevel, tones } from '../__fixtures__/audioAnalysis';
import type { Capture } from '../__fixtures__/fakeAudioContext';
import { FakeContext, FakeWorkletNode, renderGraph } from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { PAN_ANGLE_MAX, createStereoRotate, rotationAngle, rotationGains } from './stereoRotate';
import { PROCESSOR_NAME } from '../synth/workletMessages';

const SQRT_HALF = Math.SQRT1_2;
const AMPLITUDE = 0.5;
const SECONDS = 0.5;

describe('rotationGains', () => {
  it('is the identity at centre', () => {
    expect(rotationGains(0)).toEqual({ ll: 1, lr: -0, rl: 0, rr: 1 });
  });

  it('is a quarter turn at hard right, and its mirror at hard left', () => {
    const right = rotationGains(1);
    expect(right.ll).toBeCloseTo(SQRT_HALF, 12);
    expect(right.lr).toBeCloseTo(-SQRT_HALF, 12);
    expect(right.rl).toBeCloseTo(SQRT_HALF, 12);
    expect(right.rr).toBeCloseTo(SQRT_HALF, 12);

    const left = rotationGains(-1);
    expect(left.lr).toBeCloseTo(SQRT_HALF, 12);
    expect(left.rl).toBeCloseTo(-SQRT_HALF, 12);
    expect(rotationAngle(1)).toBe(PAN_ANGLE_MAX);
  });

  it('is orthonormal for every pan, which is what preserves energy', () => {
    for (const pan of [-1, -0.7, -0.3, 0, 0.25, 0.5, 0.9, 1]) {
      const g = rotationGains(pan);
      expect(g.ll * g.rr - g.lr * g.rl).toBeCloseTo(1, 12);
      expect(g.ll * g.ll + g.rl * g.rl).toBeCloseTo(1, 12);
      expect(g.ll * g.lr + g.rl * g.rr).toBeCloseTo(0, 12);
    }
  });

  it('clamps beyond the ends rather than turning past them', () => {
    expect(rotationGains(3)).toEqual(rotationGains(1));
    expect(rotationGains(-9)).toEqual(rotationGains(-1));
  });
});

describe('createStereoRotate in a graph', () => {
  let context: FakeContext;
  let source: FakeWorkletNode;

  async function rotated(
    feed: ReturnType<typeof tones>,
    pan: number,
  ): Promise<{ input: Capture; output: Capture; rotate: ReturnType<typeof createStereoRotate> }> {
    context = new FakeContext();
    await context.audioWorklet.addModule('fm-processor.js');
    source = new FakeWorkletNode(context, PROCESSOR_NAME, { numberOfInputs: 0 });
    source.feed = feed;
    const rotate = createStereoRotate(context.asAudioContext(), pan);
    source.connect(rotate.input as unknown as FakeNode);
    (rotate.output as unknown as FakeNode).connect(context.destination);
    const [input, output] = renderGraph(context, SECONDS, [source, context.destination]);
    if (!input || !output) throw new Error('render produced no captures');
    return { input, output, rotate };
  }

  const total = (c: Capture): number => energy(c.left) + energy(c.right);

  it('builds a splitter, four gains and a merger, and nothing else', () => {
    const ctx = new FakeContext();
    createStereoRotate(ctx.asAudioContext(), 0.3);
    const kinds = ctx.nodes.map((n) => n.kind).sort();
    expect(kinds).toEqual(['destination', 'gain', 'gain', 'gain', 'gain', 'merger', 'splitter']);
  });

  it('passes a source through untouched at centre', async () => {
    const { input, output } = await rotated(tones(440, 660, AMPLITUDE), 0);
    expect(output.left).toEqual(input.left);
    expect(output.right).toEqual(input.right);
  });

  it('moves a centred source fully to one side without losing energy', async () => {
    const { input, output } = await rotated(tones(440, 440, AMPLITUDE), 1);

    expect(rms(output.left)).toBeLessThan(1e-6);
    expect(rms(output.right)).toBeCloseTo(Math.SQRT2 * rms(input.right), 5);
    // A balance law at hard right would leave R' = R: half the energy gone.
    expect(total(output) / total(input)).toBeCloseTo(1, 5);

    const mirrored = await rotated(tones(440, 440, AMPLITUDE), -1);
    expect(rms(mirrored.output.right)).toBeLessThan(1e-6);
    expect(total(mirrored.output) / total(mirrored.input)).toBeCloseTo(1, 5);
  });

  it('keeps both channels of a wide source when hard-panned', async () => {
    // 440 Hz lives only in L, 660 Hz only in R. A balance law at hard right
    // mutes L, and 440 Hz vanishes from the output entirely. A rotation folds
    // both channels into both outputs at 1/sqrt2 each, so every tone survives.
    const { input, output } = await rotated(tones(440, 660, AMPLITUDE), 1);

    const inLeft440 = toneLevel(input.left, 440);
    const inRight660 = toneLevel(input.right, 660);
    expect(inLeft440).toBeGreaterThan(0.4);

    for (const channel of [output.left, output.right]) {
      expect(toneLevel(channel, 440)).toBeCloseTo(inLeft440 * SQRT_HALF, 3);
      expect(toneLevel(channel, 660)).toBeCloseTo(inRight660 * SQRT_HALF, 3);
    }
    expect(total(output) / total(input)).toBeCloseTo(1, 5);
  });

  it('follows setPan while running', async () => {
    const { rotate } = await rotated(tones(440, 440, AMPLITUDE), 0);
    expect(rotate.pan).toBe(0);
    rotate.setPan(-1);
    expect(rotate.pan).toBe(-1);
    const [after] = renderGraph(context, 0.1, [context.destination]);
    expect(rms(after?.right ?? new Float32Array(1))).toBeLessThan(1e-6);
    expect(rms(after?.left ?? new Float32Array(1))).toBeGreaterThan(0.1);
  });
});

describe('a follower rotation', () => {
  const gainsOf = (input: AudioNode): number[] =>
    (input as unknown as FakeNode).outbound.map((c) => (c.to as unknown as GainNode).gain.value);
  const expected = (pan: number): number[] => {
    const g = rotationGains(pan);
    return [g.ll, g.lr, g.rl, g.rr];
  };

  it('starts at the knob, moves with it and with the lane, and leaves the lane on dispose', () => {
    const rotate = createStereoRotate(new FakeContext() as unknown as BaseAudioContext, 0.5);
    const follower = rotate.follower();
    expect(gainsOf(follower.input)).toEqual(expected(0.5));
    rotate.setPan(-0.25);
    expect(gainsOf(follower.input)).toEqual(expected(-0.25));
    rotate.automation.hold(1, 0);
    expect(gainsOf(follower.input)).toEqual(expected(1));
    expect(gainsOf(rotate.input)).toEqual(expected(1));
    follower.dispose();
    rotate.automation.hold(0, 1);
    expect(gainsOf(rotate.input)).toEqual(expected(0));
  });
});
