/**
 * The echo's loop (#647): a resonant damping lowpass and a soft clip. A high
 * Regen with the resonance up runs away at the damping frequency — wanted —
 * and the clip holds it to a stated bound. At the Butterworth floor the
 * repeats always fade, and at ordinary levels the clip is transparent.
 */
import { describe, expect, it } from 'vitest';

import { burst, rms, tones } from './__fixtures__/audioAnalysis';
import type { Capture } from './__fixtures__/fakeAudioContext';
import { FakeContext, FakeWorkletNode, renderGraph } from './__fixtures__/fakeAudioContext';
import type { FakeNode, FakeWaveShaper } from './__fixtures__/fakeAudioNodes';
import { BLOCK, FakeBiquad } from './__fixtures__/fakeAudioNodes';
import {
  DELAY_CLIP_CEILING,
  DELAY_CLIP_CURVE_POINTS,
  DELAY_FEEDBACK_MAX,
  DELAY_RESONANCE_DEFAULT_DB,
  DELAY_RESONANCE_MAX_DB,
  DELAY_RESONANCE_MIN_DB,
} from './audioConstants';
import type { DelayReturn } from './mix';
import { RETURNS } from './mix';
import { createReturn, delayClipCurve } from './returnBus';
import { PROCESSOR_NAME } from './workletMessages';

const ECHO: DelayReturn = RETURNS.echo;
const RUNAWAY_SECONDS = 10;
const REPEATS = 20;
/** Past the Butterworth floor's decay test, the runaway must still be sounding. */
const SUSTAIN_FRACTION = 0.1;
const DECAY_FEEDBACK = 0.9;
const MODERATE_FEEDBACK = 0.5;
const LOUD_DBFS = -12;
const QUIET_DBFS = -60;
const BURST_SECONDS = 0.05;
const TONE_HZ = 440;
const TRANSPARENT_DB = 0.1;
/** How long the damping filter's impulse response is summed for its L1 norm. */
const IMPULSE_SECONDS = 1;

const fromDb = (db: number): number => 10 ** (db / 20);
const db = (ratio: number): number => 20 * Math.log10(ratio);

const impulse =
  (amplitude: number) =>
  (block: number, left: Float32Array, right: Float32Array): void => {
    if (block !== 0) return;
    left[0] = amplitude;
    right[0] = amplitude;
  };

/** Render an echo return with `spec` fed by `feed`; the capture is the return's output. */
async function renderEcho(
  spec: DelayReturn,
  feed: FakeWorkletNode['feed'],
  seconds: number,
): Promise<{ out: Capture; context: FakeContext }> {
  const context = new FakeContext();
  await context.audioWorklet.addModule('fm-processor.js');
  const source = new FakeWorkletNode(context, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = feed;
  const bus = createReturn(context.asAudioContext(), 'echo', spec, context.destination as never);
  source.connect(bus.input as unknown as FakeNode);
  const [out] = renderGraph(context, seconds, [bus.output as unknown as FakeNode]);
  if (!out) throw new Error('render produced no capture');
  return { out, context };
}

function peak(samples: Float32Array, from = 0, to = samples.length): number {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(samples[i] ?? 0));
  return max;
}

/** The damping filter's impulse-response L1 norm: the most it can scale a bounded signal. */
async function dampL1(spec: DelayReturn): Promise<number> {
  const context = new FakeContext();
  await context.audioWorklet.addModule('fm-processor.js');
  const filter = new FakeBiquad(context);
  filter.type = 'lowpass';
  filter.frequency.value = spec.damp;
  filter.Q.value = spec.resonance;
  let sum = 0;
  const blocks = Math.round((IMPULSE_SECONDS * context.sampleRate) / BLOCK);
  const source = new FakeWorkletNode(context, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = impulse(1);
  source.connect(filter);
  for (let b = 0; b < blocks; b++) for (const v of filter.pull(b)[0] ?? []) sum += Math.abs(v);
  return sum;
}

describe('delayClipCurve', () => {
  const curve = delayClipCurve();
  const mid = (DELAY_CLIP_CURVE_POINTS - 1) / 2;

  it('is odd-length with an exact zero at its centre, and odd-symmetric', () => {
    expect(curve.length % 2).toBe(1);
    expect(curve[mid]).toBe(0);
    for (const i of [1, 100, mid - 1])
      expect(curve[mid + i]).toBeCloseTo(-(curve[mid - i] ?? 0), 6);
  });

  it('rises monotonically and never passes the ceiling', () => {
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]! >= curve[i - 1]!).toBe(true);
      expect(Math.abs(curve[i]!)).toBeLessThanOrEqual(DELAY_CLIP_CEILING);
    }
  });
});

describe('the echo loop', () => {
  it('runs delay → damp → feedback → clip input → clip → delay, oversampled, at the spec resonance', async () => {
    const context = new FakeContext();
    const bus = createReturn(context.asAudioContext(), 'echo', ECHO, context.destination as never);
    const delay = bus.effect as unknown as FakeNode;
    const damp = delay.outbound[0]?.to as FakeBiquad;
    expect(damp.kind).toBe('biquad');
    expect(damp.Q.value).toBe(DELAY_RESONANCE_DEFAULT_DB);
    const feedback = damp.outbound.map((c) => c.to).find((n) => n !== (bus.output as unknown));
    const clipIn = feedback?.outbound[0]?.to;
    const clip = clipIn?.outbound[0]?.to as FakeWaveShaper | undefined;
    expect(clip?.kind).toBe('waveshaper');
    expect(clip?.oversample).toBe('2x');
    expect(clip?.outbound[0]?.to).toBe(delay);
  });

  it('keeps a full runaway sounding, and bounded by the clip ceiling', async () => {
    const spec = { ...ECHO, feedback: DELAY_FEEDBACK_MAX, resonance: DELAY_RESONANCE_MAX_DB };
    const { out, context } = await renderEcho(spec, impulse(DELAY_CLIP_CEILING), RUNAWAY_SECONDS);
    const bound = spec.level * DELAY_CLIP_CEILING * (await dampL1(spec));
    expect(out.left.every(Number.isFinite)).toBe(true);
    expect(peak(out.left)).toBeLessThanOrEqual(bound);
    const lastSecond = out.left.length - context.sampleRate;
    expect(peak(out.left, lastSecond)).toBeGreaterThan(
      SUSTAIN_FRACTION * spec.level * DELAY_CLIP_CEILING,
    );
  });

  it('fades every repeat at the Butterworth floor, below feedback 1', async () => {
    const spec = { ...ECHO, feedback: DECAY_FEEDBACK, resonance: DELAY_RESONANCE_MIN_DB };
    const seconds = (REPEATS + 1) * spec.delayTime;
    const { out, context } = await renderEcho(spec, impulse(DELAY_CLIP_CEILING), seconds);
    const window = Math.round(spec.delayTime * context.sampleRate);
    const energies: number[] = [];
    for (let k = 1; k <= REPEATS; k++) energies.push(rms(out.left, k * window, (k + 1) * window));
    for (let k = 1; k < energies.length; k++) {
      expect(energies[k]!, `repeat ${k + 1}`).toBeLessThan(energies[k - 1]!);
    }
  });

  it('is transparent at ordinary levels: a −12 dBFS echo scales like a −60 dBFS one', async () => {
    const spec = { ...ECHO, feedback: MODERATE_FEEDBACK, resonance: DELAY_RESONANCE_DEFAULT_DB };
    const seconds = REPEATS * spec.delayTime;
    const render = async (dbfs: number): Promise<number> => {
      const feed = burst(tones(TONE_HZ, TONE_HZ, fromDb(dbfs)), BURST_SECONDS);
      return rms((await renderEcho(spec, feed, seconds)).out.left);
    };
    const loud = await render(LOUD_DBFS);
    const quiet = await render(QUIET_DBFS);
    expect(Math.abs(db(loud / (quiet * fromDb(LOUD_DBFS - QUIET_DBFS))))).toBeLessThan(
      TRANSPARENT_DB,
    );
  });
});
