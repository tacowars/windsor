/**
 * The plate's stereo input through the whole graph (windsor#763): two parts,
 * one panned hard left and one hard right, play into a group carrying a
 * fully wet Plate insert, the way a drum group's hats reach it already
 * panned (`groupBus.ts`). Each part alone puts more wet energy on its own
 * side, early and over the whole render, and the two together come out
 * balanced. Before windsor#763 the plate summed its input to mono, and every
 * part's reverb sat in the middle.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { energy } from '../__fixtures__/audioAnalysis';
import type { Capture } from '../__fixtures__/fakeAudioContext';
import {
  FakeContext,
  installFakeAudioWorklet,
  renderGraph,
} from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { LOW_CUT_MIN_HZ } from '../audioConstants';
import { DEFAULT_REVERB } from '../inserts/reverbInsert';
import { makePatch } from '../patch/patch';
import { AudioPart } from '../synth/audioPart';
import type { Feed } from '../__fixtures__/reverbHarness';
import { PROCESSOR_NAME } from '../synth/workletMessages';
import { routePart } from './channelStrip';
import { createGroupBus } from './groupBus';

const undo = installFakeAudioWorklet();
afterAll(undo);

const SECONDS = 2;
const EARLY_SECONDS = 0.2;
const NOW = (run: () => void): void => run();
const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
const db = (ratio: number): number => 10 * Math.log10(ratio);

/**
 * A 50 ms noise burst, the same on both channels: a hit with a broad
 * spectrum. A tone is the wrong probe here: the direct path and the tank's
 * first taps sum on one frequency with whatever phase their lengths give it.
 */
function hit(): Feed {
  let seed = 1;
  return (block, left, right) => {
    for (let i = 0; i < left.length && (block * left.length + i) / 48000 < 0.05; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      left[i] = right[i] = (seed / 0x80000000 - 1) * 0.5;
    }
  };
}

/** The group's output with the left part, the right part or both playing the same hit. */
async function render(left: boolean, right: boolean): Promise<Capture> {
  const context = new FakeContext();
  await context.audioWorklet.addModule('fm-processor.js');
  await context.audioWorklet.addModule('reverb-processor.js');
  const ctx = context.asAudioContext();
  const master = context.createGain();
  master.connect(context.destination);
  const bus = createGroupBus(
    ctx,
    { id: 1, name: 'Drums', level: 1, pan: 0, inserts: [{ ...DEFAULT_REVERB, mix: 1 }] },
    master as unknown as AudioNode,
    { defer: NOW },
  );
  const parts: [string, number, boolean][] = [
    ['hats', -1, left],
    ['ride', 1, right],
  ];
  for (const [name, pan, playing] of parts) {
    const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, { numberOfInputs: 0 });
    if (playing) (node as unknown as { feed: Feed }).feed = hit();
    const part = new AudioPart(name, node, makePatch());
    routePart(
      part,
      { level: 1, pan, lowCut: LOW_CUT_MIN_HZ, sends: {}, inserts: [] },
      {},
      bus.input,
      {
        defer: NOW,
      },
    );
  }
  const [output] = renderGraph(context, SECONDS, [fake(bus.output)]);
  if (!output) throw new Error('render produced no capture');
  return output;
}

const early = (x: Float32Array): Float32Array => x.subarray(0, Math.round(EARLY_SECONDS * 48000));

describe('a Plate on a group keeps its parts apart', () => {
  /**
   * By margins under what it reads: 3.7 and 3.0 dB in the first 200 ms, 1.3
   * and 1.4 dB over the render. `main` (d627d18) read ±0.5 and ±0.1 dB, its
   * mono sum's own tank asymmetry, leaning left for both parts.
   */
  it('puts a hard-left part on the left and a hard-right part on the right, early and over the whole render', async () => {
    const left = await render(true, false);
    const right = await render(false, true);
    expect(db(energy(early(left.left)) / energy(early(left.right)))).toBeGreaterThan(2);
    expect(db(energy(left.left) / energy(left.right))).toBeGreaterThan(0.5);
    expect(db(energy(early(right.right)) / energy(early(right.left)))).toBeGreaterThan(2);
    expect(db(energy(right.right) / energy(right.left))).toBeGreaterThan(0.5);
  });

  it('balances the two playing together within 1 dB', async () => {
    const both = await render(true, true);
    expect(energy(both.left)).toBeGreaterThan(0);
    expect(Math.abs(db(energy(both.left) / energy(both.right)))).toBeLessThanOrEqual(1);
  });
});
