/**
 * The Echo insert (windsor#171) is the `echo` return's delay line on a strip:
 * at Mix 1 it renders what the return renders, at Mix 0 or switched off it
 * passes its input unchanged, its loop keeps the soft clip, and removing it
 * leaves none of the loop wired.
 */
import { describe, expect, it } from 'vitest';

import { burst, rms, tones } from '../__fixtures__/audioAnalysis';
import type { Capture } from '../__fixtures__/fakeAudioContext';
import { FakeContext, FakeWorkletNode, renderGraph } from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import type { FakeWaveShaper } from '../__fixtures__/fakeWaveShaper';
import { DELAY_FEEDBACK_MAX, DELAY_MAX_SECONDS } from '../audioConstants';
import { attachDelay } from '../mixer/returnEffects';
import { FieldNormaliser } from '../song/arrangementFields';
import { PROCESSOR_NAME } from '../synth/workletMessages';
import { ECHO_BOUNDS, ECHO_LINE_DEFAULTS } from './echoConstants';
import type { EchoSpec } from './echoInsert';
import { DEFAULT_ECHO, ECHO_INSERT } from './echoInsert';

const SECONDS = 2;
const BURST_SECONDS = 0.05;
const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;

async function context(): Promise<{ context: FakeContext; source: FakeWorkletNode }> {
  const c = new FakeContext();
  await c.audioWorklet.addModule('fm-processor.js');
  const source = new FakeWorkletNode(c, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = burst(tones(440, 660), BURST_SECONDS);
  return { context: c, source };
}

async function renderStage(spec: EchoSpec): Promise<{ input: Capture; output: Capture }> {
  const { context: c, source } = await context();
  const stage = ECHO_INSERT.create(c.asAudioContext(), spec);
  source.connect(fake(stage.input));
  fake(stage.output).connect(c.destination);
  const [input, output] = renderGraph(c, SECONDS, [source, fake(stage.output)]);
  if (!input || !output) throw new Error('render produced no captures');
  return { input, output };
}

describe('the Echo sound', () => {
  it("renders the echo return's line exactly at Mix 1", async () => {
    const hot = { ...DEFAULT_ECHO, feedback: DELAY_FEEDBACK_MAX, mix: 1 };
    const { output } = await renderStage(hot);

    const { context: c, source } = await context();
    // The echo return's line, as it was built before windsor#172.
    const ctx = c.asAudioContext();
    const [input, out] = [ctx.createGain(), ctx.createGain()];
    attachDelay(ctx, input, out, { ...ECHO_LINE_DEFAULTS, feedback: DELAY_FEEDBACK_MAX });
    source.connect(fake(input));
    const [returned] = renderGraph(c, SECONDS, [fake(out)]);

    const afterBurst = Math.round((BURST_SECONDS + DEFAULT_ECHO.delayTime) * c.sampleRate);
    expect(rms(output.left, afterBurst)).toBeGreaterThan(0);
    expect(output.left).toEqual(returned?.left);
    expect(output.right).toEqual(returned?.right);
  });

  it('passes the input through dry at Mix 0', async () => {
    const { input, output } = await renderStage({ ...DEFAULT_ECHO, mix: 0 });
    expect(output.left).toEqual(input.left);
    expect(output.right).toEqual(input.right);
  });

  it('passes the input through unchanged when switched off', async () => {
    const { input, output } = await renderStage({ ...DEFAULT_ECHO, enabled: false });
    expect(output.left).toEqual(input.left);
    expect(output.right).toEqual(input.right);
  });

  it('repeats past the input at its default Mix', async () => {
    const { input, output } = await renderStage(DEFAULT_ECHO);
    const afterBurst = Math.round((BURST_SECONDS + DEFAULT_ECHO.delayTime) * 48000);
    expect(rms(input.left, afterBurst)).toBe(0);
    expect(rms(output.left, afterBurst)).toBeGreaterThan(0);
  });
});

describe('the Echo graph', () => {
  it('keeps the soft clip in its loop, oversampled', async () => {
    const { context: c } = await context();
    ECHO_INSERT.create(c.asAudioContext(), DEFAULT_ECHO);
    const clip = c.nodes.find((n) => n.kind === 'waveshaper') as FakeWaveShaper | undefined;
    expect(clip?.oversample).toBe('2x');
    expect(clip?.outbound[0]?.to).toBe(c.delays[0]);
  });

  it('takes new settings as param writes, with no change to the graph', async () => {
    const { context: c } = await context();
    const stage = ECHO_INSERT.create(c.asAudioContext(), DEFAULT_ECHO);
    const before = c.nodes.map((n) => [...n.outbound]);
    stage.set({ ...DEFAULT_ECHO, delayTime: 0.5, feedback: 0.7, mix: 0.9, enabled: false });
    expect(c.nodes.map((n) => [...n.outbound])).toEqual(before);
    expect(c.delays[0]?.delayTime.value).toBe(0.5);
  });

  it('disconnects its loop when removed, and leaves the edge out of its output to the strip', async () => {
    const { context: c } = await context();
    const stage = ECHO_INSERT.create(c.asAudioContext(), DEFAULT_ECHO);
    const next = c.createGain();
    fake(stage.output).connect(next);
    stage.dispose();
    expect(c.nodes.filter((n) => n !== fake(stage.output) && n.outbound.length > 0)).toEqual([]);
    expect(fake(stage.output).outbound.map((conn) => conn.to)).toEqual([next]);
  });
});

describe('ECHO_INSERT', () => {
  it("starts at the echo return's numbers, Mix 0.30, switched on", () => {
    const { delayTime, feedback, damp, resonance } = ECHO_LINE_DEFAULTS;
    expect(DEFAULT_ECHO).toEqual({
      kind: 'echo',
      delayTime,
      feedback,
      damp,
      resonance,
      mix: 0.3,
      enabled: true,
    });
  });

  it('clamps every number to its range and reports unknown keys', () => {
    const n = new FieldNormaliser();
    const raw = { kind: 'echo', fuzz: 1, delayTime: 99, feedback: 2, damp: 1e6, resonance: 99 };
    const spec = ECHO_INSERT.normalise({ ...raw, mix: -1 }, 'x', n);
    expect(spec).toEqual({
      ...DEFAULT_ECHO,
      delayTime: DELAY_MAX_SECONDS,
      feedback: DELAY_FEEDBACK_MAX,
      damp: ECHO_BOUNDS.damp[1],
      resonance: ECHO_BOUNDS.resonance[1],
      mix: 0,
    });
    expect(n.corrections[0]).toBe('x.fuzz: unknown key dropped');
    expect(n.corrections).toHaveLength(6);
  });

  it('loads a spec with no `enabled` as on', () => {
    const n = new FieldNormaliser();
    expect(ECHO_INSERT.normalise({ kind: 'echo', mix: 0.5 }, 'x', n)).toEqual({
      ...DEFAULT_ECHO,
      mix: 0.5,
    });
    expect(n.corrections).toEqual([]);
  });
});
