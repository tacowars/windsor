/**
 * The fake DelayNode's modulated path at lags under one block (#695): the
 * ensemble's line centre reaches 1 ms, below the 128-frame block. Outside a
 * cycle the spec allows it, and clamps a computed delay to [0, max].
 */
import { describe, expect, it } from 'vitest';

import { tones } from './audioAnalysis';
import { FakeContext, FakeWorkletNode, SAMPLE_RATE, renderGraph } from './fakeAudioContext';
import { PROCESSOR_NAME } from '../synth/workletMessages';

const SECONDS = 0.1;

async function delayed(lagSeconds: number, offset = 0) {
  const context = new FakeContext();
  await context.audioWorklet.addModule('fm-processor.js');
  const source = new FakeWorkletNode(context, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = tones(440, 440);
  const delay = context.createDelay(0.05);
  const mod = context.createGain();
  const lfo = context.createOscillator(); // not started: silent, but it marks the time as modulated
  lfo.connect(mod);
  mod.connect(delay.delayTime);
  delay.delayTime.value = lagSeconds + offset;
  source.connect(delay);
  delay.connect(context.destination);
  const [input, output] = renderGraph(context, SECONDS, [source, delay]);
  return { input: input!.left, output: output!.left };
}

describe('FakeDelay, modulated, under one block', () => {
  it('passes the input through at zero lag', async () => {
    const { input, output } = await delayed(0);
    expect(output).toEqual(input);
  });

  it('shifts by a whole-sample lag shorter than the block', async () => {
    const lag = 40;
    const { input, output } = await delayed(lag / SAMPLE_RATE);
    for (let i = lag; i < input.length; i++) expect(output[i]).toBeCloseTo(input[i - lag]!, 6);
  });

  it('clamps a negative computed delay to zero', async () => {
    const { input, output } = await delayed(0, -0.004);
    expect(output).toEqual(input);
  });
});
