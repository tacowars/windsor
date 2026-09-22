/**
 * The strip's low cut (#640) is a Butterworth highpass: −3 dB at the cutoff and
 * never above unity anywhere. The last clause is what a linear `Q` of 0.707
 * would break — the spec reads a highpass `Q` in dB, so 0.707 there is a
 * +1.7 dB bump just above the cutoff (#647).
 */
import { describe, expect, it } from 'vitest';

import { rms, tones } from './__fixtures__/audioAnalysis';
import { FakeContext, FakeWorkletNode, renderGraph } from './__fixtures__/fakeAudioContext';
import type { FakeNode } from './__fixtures__/fakeAudioNodes';
import { BUTTERWORTH_Q_DB, LOW_CUT_MIN_HZ } from './audioConstants';
import { createLowCutStage } from './lowCutStage';
import { PROCESSOR_NAME } from './workletMessages';

const CUTOFF_HZ = 200;
const SECONDS = 0.5;
/** Measure after the filter's transient has gone. */
const SETTLED_FROM = 0.25;
const AMPLITUDE = 0.5;
const TOLERANCE_DB = 0.1;
/** A 12 dB/octave slope: two octaves down is −24 dB, so −20 is a safe floor. */
const TWO_OCTAVES_DOWN_MAX_DB = -20;

const db = (ratio: number): number => 20 * Math.log10(ratio);

/** The filter's gain at `hz`, in dB, read off a rendered steady sine. */
async function gainAt(hz: number, cutoff = CUTOFF_HZ): Promise<number> {
  const context = new FakeContext();
  await context.audioWorklet.addModule('fm-processor.js');
  const source = new FakeWorkletNode(context, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = tones(hz, hz, AMPLITUDE);
  const stage = createLowCutStage(context.asAudioContext(), cutoff);
  const filter = stage.filter as unknown as FakeNode;
  source.connect(filter);
  filter.connect(context.destination);
  const [input, output] = renderGraph(context, SECONDS, [source, filter]);
  if (!input || !output) throw new Error('render produced no captures');
  const from = Math.round(SETTLED_FROM * context.sampleRate);
  return db(rms(output.left, from) / rms(input.left, from));
}

describe('createLowCutStage', () => {
  it('is one highpass biquad, Butterworth in the dB units the spec reads', () => {
    const context = new FakeContext();
    const stage = createLowCutStage(context.asAudioContext(), CUTOFF_HZ);
    expect(stage.input).toBe(stage.filter);
    expect(stage.output).toBe(stage.filter);
    expect(stage.filter.type).toBe('highpass');
    expect(stage.filter.frequency.value).toBe(CUTOFF_HZ);
    expect(stage.filter.Q.value).toBe(BUTTERWORTH_Q_DB);
    expect(BUTTERWORTH_Q_DB).toBeCloseTo(-3.0103, 4);
  });

  it('moves the cutoff live', () => {
    const stage = createLowCutStage(new FakeContext().asAudioContext(), CUTOFF_HZ);
    stage.setFrequency(LOW_CUT_MIN_HZ);
    expect(stage.filter.frequency.value).toBe(LOW_CUT_MIN_HZ);
  });

  it('is −3 dB at the cutoff', async () => {
    expect(await gainAt(CUTOFF_HZ)).toBeCloseTo(-3.0103, 1);
  });

  it('never rises above unity above the cutoff, where a linear 0.707 would peak', async () => {
    for (const ratio of [1.2, 1.41, 2, 4, 10]) {
      expect(await gainAt(CUTOFF_HZ * ratio), `${ratio}× cutoff`).toBeLessThan(TOLERANCE_DB / 10);
    }
  });

  it('cuts two octaves below the cutoff by at least 20 dB', async () => {
    expect(await gainAt(CUTOFF_HZ / 4)).toBeLessThan(TWO_OCTAVES_DOWN_MAX_DB);
  });
});
