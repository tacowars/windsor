/**
 * The drive insert (#641): a tanh saturator whose Drive changes colour more
 * than level, a Butterworth tone control, and a parallel dry path — all set by
 * param writes on one fixed graph.
 */
import { describe, expect, it } from 'vitest';

import { biquadL1, rms, toneLevel, tones } from '../__fixtures__/audioAnalysis';
import type { Capture } from '../__fixtures__/fakeAudioContext';
import { FakeContext, FakeWorkletNode, renderGraph } from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import type { FakeWaveShaper } from '../__fixtures__/fakeWaveShaper';
import { FakeBiquad } from '../__fixtures__/fakeAudioNodes';
import { BUTTERWORTH_Q_DB } from '../audioConstants';
import { PROCESSOR_NAME } from '../workletMessages';
import type { DriveSpec } from './driveInsert';
import { DEFAULT_DRIVE, DRIVE_INSERT, driveCompensation } from './driveInsert';
import {
  DRIVE_CURVE_POINTS,
  DRIVE_GAIN_MAX_DB,
  DRIVE_GAIN_MIN_DB,
  DRIVE_TONE_MAX_HZ,
} from './insertConstants';

const TONE_HZ = 440;
const SECONDS = 0.5;
const SETTLED_FROM = 0.25;
const MINUS_12_DBFS = 0.25;
const FULL_SCALE = 1;
/** At the least drive the stage is within this of unity on a −12 dBFS sine. */
const CLEAN_TOLERANCE_DB = 0.25;
/** tanh at −12 dBFS leaves the third harmonic near −45 dB; −35 is a safe ceiling. */
const CLEAN_THIRD_MAX_DB = -35;
const DRIVEN_DB = 24;
const DRIVEN_THIRD_MIN_DB = -20;

const db = (ratio: number): number => 20 * Math.log10(ratio);
const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;

async function render(
  spec: DriveSpec,
  amplitude: number,
): Promise<{ input: Capture; output: Capture; from: number }> {
  const context = new FakeContext();
  await context.audioWorklet.addModule('fm-processor.js');
  const source = new FakeWorkletNode(context, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = tones(TONE_HZ, TONE_HZ, amplitude);
  const stage = DRIVE_INSERT.create(context.asAudioContext(), spec);
  source.connect(fake(stage.input));
  fake(stage.output).connect(context.destination);
  const [input, output] = renderGraph(context, SECONDS, [source, fake(stage.output)]);
  if (!input || !output) throw new Error('render produced no captures');
  return { input, output, from: Math.round(SETTLED_FROM * context.sampleRate) };
}

function thirdHarmonicDb(capture: Capture, from: number): number {
  const settled = capture.left.subarray(from);
  return db(toneLevel(settled, 3 * TONE_HZ) / toneLevel(settled, TONE_HZ));
}

function peak(samples: Float32Array): number {
  let max = 0;
  for (const v of samples) max = Math.max(max, Math.abs(v));
  return max;
}

describe('the drive graph', () => {
  it('is a fixed tanh curve, oversampled, with a Butterworth tone filter', () => {
    const context = new FakeContext();
    DRIVE_INSERT.create(context.asAudioContext(), DEFAULT_DRIVE);
    const shaper = context.nodes.find((n) => n.kind === 'waveshaper') as FakeWaveShaper;
    const tone = context.nodes.find((n): n is FakeBiquad => n instanceof FakeBiquad);
    expect(shaper.oversample).toBe('2x');
    expect(shaper.curve?.length).toBe(DRIVE_CURVE_POINTS);
    expect(tone?.type).toBe('lowpass');
    expect(tone?.Q.value).toBe(BUTTERWORTH_Q_DB);
    expect(tone?.frequency.value).toBe(DEFAULT_DRIVE.tone);
  });

  it('takes new settings as param writes, with no change to the graph or the curve', () => {
    const context = new FakeContext();
    const stage = DRIVE_INSERT.create(context.asAudioContext(), DEFAULT_DRIVE);
    const shaper = context.nodes.find((n) => n.kind === 'waveshaper') as FakeWaveShaper;
    const curve = shaper.curve;
    const before = context.nodes.map((n) => [...n.outbound]);
    stage.set({ ...DEFAULT_DRIVE, drive: DRIVE_GAIN_MAX_DB, tone: 1200, mix: 0.3 });
    expect(context.nodes.map((n) => [...n.outbound])).toEqual(before);
    expect(shaper.curve).toBe(curve);
    expect(
      context.nodes.find((n): n is FakeBiquad => n instanceof FakeBiquad)?.frequency.value,
    ).toBe(1200);
  });

  it('disconnects what it built and leaves the edge out of its output to the strip', () => {
    const context = new FakeContext();
    const stage = DRIVE_INSERT.create(context.asAudioContext(), DEFAULT_DRIVE);
    const next = context.createGain();
    fake(stage.output).connect(next);
    stage.dispose();
    expect(fake(stage.input).outbound).toEqual([]);
    expect(context.nodes.filter((n) => n !== fake(stage.output) && n.outbound.length > 0)).toEqual(
      [],
    );
    expect(fake(stage.output).outbound.map((c) => c.to)).toEqual([next]);
  });
});

describe('the drive sound', () => {
  const clean = { ...DEFAULT_DRIVE, drive: DRIVE_GAIN_MIN_DB, tone: DRIVE_TONE_MAX_HZ, mix: 1 };

  it('is within 0.25 dB of unity on a −12 dBFS sine at the least drive', async () => {
    const { input, output, from } = await render(clean, MINUS_12_DBFS);
    const gain = db(rms(output.left, from) / rms(input.left, from));
    expect(Math.abs(gain)).toBeLessThan(CLEAN_TOLERANCE_DB);
    expect(thirdHarmonicDb(output, from)).toBeLessThan(CLEAN_THIRD_MAX_DB);
  });

  it('adds harmonics as Drive rises, at a similar level', async () => {
    const low = await render(clean, MINUS_12_DBFS);
    const high = await render({ ...clean, drive: DRIVEN_DB }, MINUS_12_DBFS);
    const lowThird = thirdHarmonicDb(low.output, low.from);
    const highThird = thirdHarmonicDb(high.output, high.from);
    expect(highThird).toBeGreaterThan(DRIVEN_THIRD_MIN_DB);
    expect(highThird).toBeGreaterThan(lowThird);
  });

  it('stays finite and inside the compensated ceiling at full drive and full scale', async () => {
    const spec = { ...clean, drive: DRIVE_GAIN_MAX_DB };
    const { output } = await render(spec, FULL_SCALE);
    expect(output.left.every(Number.isFinite)).toBe(true);
    // tanh never passes 1, and the tone filter can scale that by at most its L1 norm.
    const tone = biquadL1({ type: 'lowpass', frequency: spec.tone, Q: BUTTERWORTH_Q_DB });
    expect(peak(output.left)).toBeLessThanOrEqual(driveCompensation(spec.drive) * tone);
  });

  it('passes the dry signal untouched at Mix 0', async () => {
    const { input, output } = await render({ ...DEFAULT_DRIVE, mix: 0 }, MINUS_12_DBFS);
    expect(output.left).toEqual(input.left);
  });
});

describe('DRIVE_INSERT.normalise', () => {
  it('fills the defaults, clamps each field and reports unknown keys', async () => {
    const { FieldNormaliser } = await import('../arrangementFields');
    const n = new FieldNormaliser();
    const spec = DRIVE_INSERT.normalise({ kind: 'drive', drive: 99, fuzz: 1 }, 'x', n);
    expect(spec).toEqual({ ...DEFAULT_DRIVE, drive: DRIVE_GAIN_MAX_DB });
    expect(n.corrections).toEqual([
      'x.fuzz: unknown key dropped',
      `x.drive: clamped 99 to ${DRIVE_GAIN_MAX_DB}`,
    ]);
  });
});
