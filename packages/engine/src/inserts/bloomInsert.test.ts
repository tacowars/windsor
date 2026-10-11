/**
 * The bloom stage on Windsor's fake context (`installParamWorklet`): the
 * graph, `set` without re-wiring, the lanes, and `dispose`.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { installParamWorklet, type ParamWorkletNode } from '../__fixtures__/insertParamRig';
import { BLOOM_NAME } from './bloomConstants';
import { BLOOM_INSERT, bloomValues } from './bloomInsert';
import { DEFAULT_BLOOM } from './bloomSpec';
import type { BloomSpec } from './bloomSpec';

const undo = installParamWorklet();
afterAll(undo);

function create(spec: BloomSpec = DEFAULT_BLOOM) {
  const context = new FakeContext();
  const stage = BLOOM_INSERT.create(context.asAudioContext(), spec);
  const node = stage.processor as unknown as ParamWorkletNode;
  const values = (): Record<string, number> =>
    Object.fromEntries([...node.parameters].map(([key, param]) => [key, param.value]));
  const targets = (from: unknown): unknown[] => (from as FakeNode).outbound.map((c) => c.to);
  return { context, stage, node, values, targets };
}

describe('the bloom stage', () => {
  it('builds input → processor (output 0) → output with the spec as its parameter data', () => {
    const { stage, node, context, values, targets } = create();
    expect(node.name).toBe(BLOOM_NAME);
    expect(node.numberOfOutputs).toBe(1);
    expect(values()).toEqual(bloomValues(DEFAULT_BLOOM));
    expect(targets(stage.input)).toEqual([node]);
    expect(targets(node)).toEqual([stage.output]);
    expect(node.outbound[0]!.output).toBe(0);
    expect(context.nodes.filter((n) => n !== context.destination)).toHaveLength(3);
  });

  it('writes every param on set without re-wiring', () => {
    const { stage, context, values } = create();
    const edges = context.nodes.map((n) => [...n.outbound]);
    const next: BloomSpec = {
      ...DEFAULT_BLOOM,
      amount: 0.5,
      mix: 0.8,
      swell: 2,
      sustain: 5,
      freeze: true,
      spread: 0.7,
      shape: 1.5,
      bright: -3,
      octave: 12,
      key: 'D#',
      scale: 'dorian',
      low: 50,
      high: 70,
      focus: 1.5,
      density: 0.9,
      enabled: false,
    };
    stage.set(next);
    expect(context.nodes.map((n) => n.outbound)).toEqual(edges);
    expect(values()).toEqual(bloomValues(next));
    expect(bloomValues(next)).toMatchObject({ freeze: 1, key: 3, scale: 3, enabled: 0 });
  });

  it('hands out lanes for the numbers, enabled and freeze only', () => {
    const { stage } = create();
    for (const field of [
      'amount',
      'mix',
      'swell',
      'sustain',
      'spread',
      'shape',
      'bright',
      'octave',
      'low',
      'high',
      'focus',
      'density',
      'freeze',
      'enabled',
    ])
      expect(stage.param!(field), field).toBeDefined();
    for (const field of ['key', 'scale', 'slot', 'kind'])
      expect(stage.param!(field)).toBeUndefined();
  });

  it('disposes only what it built, and stops and closes the port', () => {
    const { stage, node, context, targets } = create();
    const close = vi.spyOn(node.port, 'close');
    const output = stage.output as unknown as FakeNode;
    output.connect(context.destination);
    stage.dispose();
    expect(targets(output)).toEqual([context.destination]);
    expect(context.nodes.filter((n) => n !== output && n.outbound.length)).toEqual([]);
    expect(node.posted).toEqual([{ type: 'stop' }]);
    expect(close).toHaveBeenCalledOnce();
  });
});
