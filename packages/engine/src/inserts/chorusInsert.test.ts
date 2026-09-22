/**
 * The chorus insert (#642): LFO-modulated delay voices in native nodes. Its
 * settings are param writes on a fixed graph, its teardown stops every
 * oscillator, and its sound is what a chorus is — sidebands at the LFO rate
 * around a steady tone, a spread that pulls the sides apart, and a Mix of 0
 * that is the dry signal exactly.
 */
import { describe, expect, it } from 'vitest';

import { toneLevel, tones } from '../__fixtures__/audioAnalysis';
import type { Capture } from '../__fixtures__/fakeAudioContext';
import { FakeContext, FakeWorkletNode, renderGraph } from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { FakeDelay } from '../__fixtures__/fakeAudioNodes';
import { FakeOscillator } from '../__fixtures__/fakeOscillator';
import { FieldNormaliser } from '../arrangementFields';
import { PROCESSOR_NAME } from '../workletMessages';
import type { ChorusSpec } from './chorusInsert';
import { CHORUS_INSERT, DEFAULT_CHORUS } from './chorusInsert';
import {
  CHORUS_DEPTH_MAX_MS,
  CHORUS_RATE_MAX_HZ,
  CHORUS_VOICE_CENTRES_MS,
  CHORUS_VOICE_RATIOS,
} from './insertConstants';

const TONE_HZ = 440;
const AMPLITUDE = 0.25;
const SECONDS = 2;
/** Past the delay lines filling, so every voice is sounding. */
const SETTLED_FROM = 0.25;
const RATE_HZ = 4;
/**
 * Levels are read through a Hann window, which halves a steady tone's reading
 * (its coherent gain) and drops the input tone's leakage four hertz away far
 * below either threshold, so what remains at a sideband is modulation.
 */
const HANN_GAIN = 0.5;
/** A sideband this far below the input's own amplitude is a real one. */
const SIDEBAND_MIN = 0.02;
/** With no depth there is no modulation, so nothing above the window's leakage. */
const NO_SIDEBAND_MAX = 0.002;

function hann(samples: Float32Array): Float32Array {
  const n = samples.length;
  return samples.map((v, i) => v * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))));
}

const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
const oscillators = (context: FakeContext): FakeOscillator[] =>
  context.nodes.filter((n): n is FakeOscillator => n instanceof FakeOscillator);
const delays = (context: FakeContext): FakeDelay[] =>
  context.nodes.filter((n): n is FakeDelay => n instanceof FakeDelay);

async function render(
  spec: ChorusSpec,
): Promise<{ input: Capture; output: Capture; from: number }> {
  const context = new FakeContext();
  await context.audioWorklet.addModule('fm-processor.js');
  const source = new FakeWorkletNode(context, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = tones(TONE_HZ, TONE_HZ, AMPLITUDE);
  const stage = CHORUS_INSERT.create(context.asAudioContext(), spec);
  source.connect(fake(stage.input));
  fake(stage.output).connect(context.destination);
  const [input, output] = renderGraph(context, SECONDS, [source, fake(stage.output)]);
  if (!input || !output) throw new Error('render produced no captures');
  return { input, output, from: Math.round(SETTLED_FROM * context.sampleRate) };
}

describe('the chorus graph', () => {
  it('runs one started LFO per voice into both of its delay lines, centred', () => {
    const context = new FakeContext();
    CHORUS_INSERT.create(context.asAudioContext(), DEFAULT_CHORUS);
    const lfos = oscillators(context);
    expect(lfos).toHaveLength(CHORUS_VOICE_CENTRES_MS.length);
    expect(lfos.every((o) => o.started && !o.stopped)).toBe(true);
    lfos.forEach((lfo, v) => {
      expect(lfo.frequency.value).toBeCloseTo(DEFAULT_CHORUS.rate * CHORUS_VOICE_RATIOS[v]!, 9);
    });
    const lines = delays(context);
    expect(lines).toHaveLength(2 * CHORUS_VOICE_CENTRES_MS.length);
    for (const line of lines) {
      expect(line.delayTime.inputs).toHaveLength(1);
      expect(CHORUS_VOICE_CENTRES_MS.map((ms) => ms / 1000)).toContain(line.delayTime.value);
    }
  });

  it('takes new settings as param writes, with no change to the graph', () => {
    const context = new FakeContext();
    const stage = CHORUS_INSERT.create(context.asAudioContext(), DEFAULT_CHORUS);
    const edges = (): unknown => context.nodes.map((n) => [[...n.outbound], [...n.paramOutbound]]);
    const before = edges();
    stage.set({ ...DEFAULT_CHORUS, rate: CHORUS_RATE_MAX_HZ, depth: 0, spread: 1, mix: 1 });
    expect(edges()).toEqual(before);
    expect(oscillators(context)[0]?.frequency.value).toBe(CHORUS_RATE_MAX_HZ);
  });

  it('stops every oscillator on dispose and leaves only the strip edge out of its output', () => {
    const context = new FakeContext();
    const stage = CHORUS_INSERT.create(context.asAudioContext(), DEFAULT_CHORUS);
    const next = context.createGain();
    fake(stage.output).connect(next);
    stage.dispose();
    expect(oscillators(context).every((o) => o.stopped)).toBe(true);
    const wired = context.nodes.filter(
      (n) => n !== fake(stage.output) && (n.outbound.length > 0 || n.paramOutbound.length > 0),
    );
    expect(wired).toEqual([]);
    expect(delays(context).every((d) => d.delayTime.inputs.length === 0)).toBe(true);
    expect(fake(stage.output).outbound.map((c) => c.to)).toEqual([next]);
  });
});

describe('the chorus sound', () => {
  const sidebands = (capture: Capture, from: number, rate: number): number[] => {
    const settled = hann(capture.left.subarray(from));
    return CHORUS_VOICE_RATIOS.map((ratio) => toneLevel(settled, TONE_HZ + rate * ratio));
  };

  it('passes the dry signal untouched at Mix 0', async () => {
    const { input, output } = await render({ ...DEFAULT_CHORUS, mix: 0 });
    expect(output.left).toEqual(input.left);
    expect(output.right).toEqual(input.right);
  });

  it('puts sidebands at each voice’s LFO rate around a steady tone', async () => {
    const wet = { ...DEFAULT_CHORUS, rate: RATE_HZ, depth: CHORUS_DEPTH_MAX_MS, mix: 1 };
    const moving = await render(wet);
    expect(moving.output.left.every(Number.isFinite)).toBe(true);
    for (const level of sidebands(moving.output, moving.from, RATE_HZ)) {
      expect(level).toBeGreaterThan(SIDEBAND_MIN * AMPLITUDE * HANN_GAIN);
    }
    const still = await render({ ...wet, depth: 0 });
    for (const level of sidebands(still.output, still.from, RATE_HZ)) {
      expect(level).toBeLessThan(NO_SIDEBAND_MAX * AMPLITUDE * HANN_GAIN);
    }
  });

  it('moves the two sides together at Spread 0 and apart at Spread 1', async () => {
    const wet = { ...DEFAULT_CHORUS, rate: RATE_HZ, depth: CHORUS_DEPTH_MAX_MS, mix: 1 };
    const narrow = await render({ ...wet, spread: 0 });
    expect(narrow.output.right).toEqual(narrow.output.left);
    const wide = await render({ ...wet, spread: 1 });
    const differs = wide.output.left.some(
      (v, i) => Math.abs(v - (wide.output.right[i] ?? 0)) > 1e-3,
    );
    expect(differs).toBe(true);
  });
});

describe('CHORUS_INSERT.normalise', () => {
  it('fills the defaults, clamps each field and reports unknown keys', () => {
    const n = new FieldNormaliser();
    const spec = CHORUS_INSERT.normalise({ kind: 'chorus', depth: 40, spread: -2, wat: 1 }, 'x', n);
    expect(spec).toEqual({ ...DEFAULT_CHORUS, depth: CHORUS_DEPTH_MAX_MS, spread: 0 });
    expect(n.corrections).toEqual([
      'x.wat: unknown key dropped',
      `x.depth: clamped 40 to ${CHORUS_DEPTH_MAX_MS}`,
      'x.spread: clamped -2 to 0',
    ]);
  });
});
