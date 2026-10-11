/**
 * The bloom stage on Windsor's fake context (`installParamWorklet`): the
 * graph, `set` without re-wiring, the lanes, and `dispose`.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeGain, FakeNode } from '../__fixtures__/fakeAudioNodes';
import { installParamWorklet, type ParamWorkletNode } from '../__fixtures__/insertParamRig';
import { BLOOM_NAME, BLOOM_SLOT } from './bloomConstants';
import { BLOOM_INSERT, bloomValues } from './bloomInsert';
import { pitchMask } from './bloomPitches';
import { SCALES } from '../sequencing/scaleSampler';
import { DEFAULT_BLOOM } from './bloomSpec';
import type { BloomSpec } from './bloomSpec';

const undo = installParamWorklet();
afterAll(undo);

function create(spec: BloomSpec = DEFAULT_BLOOM) {
  const context = new FakeContext();
  const stage = BLOOM_INSERT.create(context.asAudioContext(), spec);
  const node = stage.processor as unknown as ParamWorkletNode;
  // Every field's param; the stage's own `split` (the slot's crossing) is no field's.
  const values = (): Record<string, number> =>
    Object.fromEntries(
      [...node.parameters]
        .filter(([key]) => key !== BLOOM_SLOT.splitParam)
        .map(([key, param]) => [key, param.value]),
    );
  const targets = (from: unknown): unknown[] => (from as FakeNode).outbound.map((c) => c.to);
  return { context, stage, node, values, targets };
}

describe('the bloom stage', () => {
  it('builds input → processor (output 0) → output, and the slot’s return, with the spec as its parameter data', () => {
    const { stage, node, context, values, targets } = create();
    expect(node.name).toBe(BLOOM_NAME);
    expect(node.numberOfOutputs).toBe(BLOOM_SLOT.outputs);
    expect(values()).toEqual(bloomValues(DEFAULT_BLOOM));
    expect(targets(stage.input)).toEqual([node]);
    expect(targets(node)).toEqual([stage.output]);
    expect(node.outbound[0]!.output).toBe(BLOOM_SLOT.mixOutput);
    // The wet path: output 1 leaves for a child; the return, silent, takes output 2 as its gain.
    const { send, ret } = stage.wetPath!;
    expect(send).toEqual({ node, output: BLOOM_SLOT.wetOutput });
    const back = ret as unknown as FakeGain;
    expect(back.gain.value).toBe(0);
    expect(back.gain.inputs).toEqual([node]);
    expect(targets(back)).toEqual([stage.output]);
    expect(context.nodes.filter((n) => n !== context.destination)).toHaveLength(4);
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
    // D♯ dorian: D♯ F F♯ G♯ A♯ C C♯, pitch classes 3 5 6 8 10 0 1, as one 12-bit set.
    expect(bloomValues(next)).toMatchObject({ freeze: 1, pitches: 0b010101101011, enabled: 0 });
    expect(bloomValues(next)).not.toHaveProperty('key');
    expect(bloomValues(DEFAULT_BLOOM).pitches).toBe(4095);
  });

  it("retunes on the song's key only while Scale is on song, and keeps its own key underneath", () => {
    const { stage, node } = create({ ...DEFAULT_BLOOM, key: 'F', scale: 'major' });
    const pitches = (): number => node.parameters.get('pitches').value;
    const fMajor = pitchMask(5, SCALES.major);
    // A fixed scale ignores the song's key.
    stage.setHarmony!(2, 'dorian');
    expect(pitches()).toBe(fMajor);
    // On song, the song's key, Key aside, and the stage keeps following it.
    const onSong: BloomSpec = { ...DEFAULT_BLOOM, key: 'F', scale: 'song' };
    stage.set(onSong);
    expect(pitches()).toBe(pitchMask(2, SCALES.dorian));
    stage.setHarmony!(7, [0, 4, 7]);
    expect(pitches()).toBe(pitchMask(7, [0, 4, 7]));
    // Back to a fixed scale: the bloom's own F.
    stage.set({ ...onSong, scale: 'major' });
    expect(pitches()).toBe(fMajor);
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
