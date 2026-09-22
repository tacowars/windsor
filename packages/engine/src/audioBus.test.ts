/**
 * A bus filter's default `Q` is Butterworth in the unit the spec reads for its
 * type (#647): dB for a lowpass or highpass, so the music bus's 30 Hz
 * highpass is flat above the cutoff instead of the +1.7 dB bump a linear
 * 0.707 made there.
 */
import { describe, expect, it } from 'vitest';

import { rms, tones } from './__fixtures__/audioAnalysis';
import { FakeContext, FakeWorkletNode, renderGraph } from './__fixtures__/fakeAudioContext';
import type { FakeNode } from './__fixtures__/fakeAudioNodes';
import { createBus } from './audioBus';
import { BUTTERWORTH_Q_DB } from './audioConstants';
import { PROCESSOR_NAME } from './workletMessages';

/** The music bus's highpass (`AudioSystem.init`). */
const MUSIC_HIGHPASS_HZ = 30;
const SECONDS = 1;
const SETTLED_FROM = 0.5;
const AMPLITUDE = 0.5;
/** Web Audio's own `Q`, which a type outside lowpass / highpass keeps. */
const WEB_AUDIO_DEFAULT_Q = 1;
const UNITY_MARGIN_DB = 0.01;
const CUTOFF_TOLERANCE_DB = 0.1;

const db = (ratio: number): number => 20 * Math.log10(ratio);

/** The music bus highpass's gain at `hz`, in dB, read off a rendered steady sine. */
async function gainAt(hz: number): Promise<number> {
  const context = new FakeContext();
  await context.audioWorklet.addModule('fm-processor.js');
  const source = new FakeWorkletNode(context, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = tones(hz, hz, AMPLITUDE);
  const bus = createBus(context.asAudioContext(), {
    filter: { type: 'highpass', frequency: MUSIC_HIGHPASS_HZ },
  });
  const output = bus.output as unknown as FakeNode;
  source.connect(bus.input as unknown as FakeNode);
  output.connect(context.destination);
  const [input, out] = renderGraph(context, SECONDS, [source, output]);
  if (!input || !out) throw new Error('render produced no captures');
  const from = Math.round(SETTLED_FROM * context.sampleRate);
  return db(rms(out.left, from) / rms(input.left, from));
}

describe('createBus filter Q', () => {
  it('defaults a lowpass or highpass to Butterworth in dB', () => {
    const ctx = new FakeContext().asAudioContext();
    for (const type of ['lowpass', 'highpass'] as const) {
      expect(createBus(ctx, { filter: { type } }).filter?.Q.value, type).toBe(BUTTERWORTH_Q_DB);
    }
  });

  it("leaves any other type at Web Audio's default, whose Q is linear", () => {
    const ctx = new FakeContext().asAudioContext();
    const bus = createBus(ctx, { filter: { type: 'bandpass' } });
    expect(bus.filter?.Q.value).toBe(WEB_AUDIO_DEFAULT_Q);
  });

  it("keeps the caller's Q when one is named", () => {
    const ctx = new FakeContext().asAudioContext();
    const bus = createBus(ctx, { filter: { type: 'highpass', Q: 6 } });
    expect(bus.filter?.Q.value).toBe(6);
  });
});

describe("the music bus's 30 Hz highpass", () => {
  it('is −3 dB at 30 Hz', async () => {
    expect(Math.abs((await gainAt(MUSIC_HIGHPASS_HZ)) + 3.0103)).toBeLessThan(CUTOFF_TOLERANCE_DB);
  });

  it('never rises above unity above the cutoff', async () => {
    for (const hz of [36, 42, 60, 120, 300]) {
      expect(await gainAt(hz), `${hz} Hz`).toBeLessThan(UNITY_MARGIN_DB);
    }
  });
});
