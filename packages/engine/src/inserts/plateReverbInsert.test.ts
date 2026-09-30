/**
 * The Plate reverb insert (windsor#171) is the `room` return's plate on a
 * strip: at Mix 1 in the hall space it renders what the return renders, at
 * Mix 0 or switched off it passes its input unchanged, and a settings change
 * is param writes on one fixed graph.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { burst, rms, tones } from '../__fixtures__/audioAnalysis';
import type { Capture } from '../__fixtures__/fakeAudioContext';
import {
  FakeContext,
  FakeWorkletNode,
  installFakeAudioWorklet,
  renderGraph,
} from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { REVERB_SPACE_RANGES } from '../audioConstants';
import { RETURNS } from '../mixer/mix';
import { createReturn } from '../mixer/returnBus';
import { SPACES } from '../mixer/reverbSpace';
import { FieldNormaliser } from '../song/arrangementFields';
import { PROCESSOR_NAME, REVERB_PROCESSOR_NAME } from '../synth/workletMessages';
import type { PlateReverbSpec } from './plateReverbInsert';
import { DEFAULT_PLATE_REVERB, PLATE_REVERB_INSERT, plateSpace } from './plateReverbInsert';

const SECONDS = 1.5;
const BURST_SECONDS = 0.1;
const TAIL_FROM_SECONDS = 0.5;
const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;

let restore: () => void = () => {};
beforeAll(() => {
  restore = installFakeAudioWorklet();
});
afterAll(() => restore());

async function context(): Promise<{ context: FakeContext; source: FakeWorkletNode }> {
  const c = new FakeContext();
  await c.audioWorklet.addModule('fm-processor.js');
  await c.audioWorklet.addModule('reverb-processor.js');
  const source = new FakeWorkletNode(c, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = burst(tones(330, 440), BURST_SECONDS);
  return { context: c, source };
}

async function renderStage(spec: PlateReverbSpec): Promise<{ input: Capture; output: Capture }> {
  const { context: c, source } = await context();
  const stage = PLATE_REVERB_INSERT.create(c.asAudioContext(), spec);
  source.connect(fake(stage.input));
  fake(stage.output).connect(c.destination);
  const [input, output] = renderGraph(c, SECONDS, [source, fake(stage.output)]);
  if (!input || !output) throw new Error('render produced no captures');
  return { input, output };
}

describe('the Plate reverb sound', () => {
  it("renders the room return's plate exactly at Mix 1 in the hall space", async () => {
    const { output } = await renderStage({ ...DEFAULT_PLATE_REVERB, mix: 1 });

    const { context: c, source } = await context();
    const room = { ...RETURNS.room, level: 1 };
    const bus = createReturn(c.asAudioContext(), 'room', room, c.destination as never);
    source.connect(fake(bus.input));
    const [returned] = renderGraph(c, SECONDS, [fake(bus.output)]);

    expect(rms(output.left, Math.round(TAIL_FROM_SECONDS * c.sampleRate))).toBeGreaterThan(0);
    expect(output.left).toEqual(returned?.left);
    expect(output.right).toEqual(returned?.right);
  });

  it('passes the input through dry at Mix 0', async () => {
    const { input, output } = await renderStage({ ...DEFAULT_PLATE_REVERB, mix: 0 });
    expect(output.left).toEqual(input.left);
    expect(output.right).toEqual(input.right);
  });

  it('passes the input through unchanged when switched off', async () => {
    const { input, output } = await renderStage({ ...DEFAULT_PLATE_REVERB, enabled: false });
    expect(output.left).toEqual(input.left);
    expect(output.right).toEqual(input.right);
  });

  it('adds a tail past the input at its default Mix', async () => {
    const { input, output } = await renderStage(DEFAULT_PLATE_REVERB);
    const tail = Math.round(TAIL_FROM_SECONDS * 48000);
    expect(rms(input.left, tail)).toBe(0);
    expect(rms(output.left, tail)).toBeGreaterThan(0);
  });
});

describe('the Plate reverb graph', () => {
  it('drives the processor with its space and Mix as the plate’s own wet and dry', async () => {
    const { context: c } = await context();
    const stage = PLATE_REVERB_INSERT.create(c.asAudioContext(), DEFAULT_PLATE_REVERB);
    const plate = c.workletNodes.find((n) => n.name === REVERB_PROCESSOR_NAME);
    expect(stage.processor).toBe(plate);
    expect(plate?.parameters.get('wet')?.value).toBeCloseTo(DEFAULT_PLATE_REVERB.mix, 6);
    expect(plate?.parameters.get('dry')?.value).toBeCloseTo(1 - DEFAULT_PLATE_REVERB.mix, 6);
    expect(plate?.parameters.get('size')?.value).toBe(SPACES.hall.size);
  });

  it('takes new settings as param writes, with no change to the graph', async () => {
    const { context: c } = await context();
    const stage = PLATE_REVERB_INSERT.create(c.asAudioContext(), DEFAULT_PLATE_REVERB);
    const before = c.nodes.map((n) => [...n.outbound]);
    stage.set({ ...DEFAULT_PLATE_REVERB, ...SPACES.cathedral, mix: 0.8, enabled: false });
    expect(c.nodes.map((n) => [...n.outbound])).toEqual(before);
    const plate = c.workletNodes.find((n) => n.name === REVERB_PROCESSOR_NAME);
    expect(plate?.parameters.get('size')?.value).toBe(SPACES.cathedral.size);
    expect(plate?.parameters.get('wet')?.value).toBeCloseTo(0.8, 6);
  });

  it('disconnects what it built and leaves the edge out of its output to the strip', async () => {
    const { context: c } = await context();
    const stage = PLATE_REVERB_INSERT.create(c.asAudioContext(), DEFAULT_PLATE_REVERB);
    const next = c.createGain();
    fake(stage.output).connect(next);
    stage.dispose();
    expect(c.nodes.filter((n) => n !== fake(stage.output) && n.outbound.length > 0)).toEqual([]);
    expect(fake(stage.output).outbound.map((conn) => conn.to)).toEqual([next]);
  });
});

describe('PLATE_REVERB_INSERT', () => {
  it('starts in the hall space at Mix 0.30, switched on', () => {
    expect(plateSpace(DEFAULT_PLATE_REVERB)).toEqual(SPACES.hall);
    expect(DEFAULT_PLATE_REVERB.mix).toBe(0.3);
    expect(DEFAULT_PLATE_REVERB.enabled).toBe(true);
  });

  it('clamps every number to its range and reports unknown keys', () => {
    const n = new FieldNormaliser();
    const raw: Record<string, unknown> = { kind: 'plate', fuzz: 1, mix: 2 };
    for (const field of Object.keys(REVERB_SPACE_RANGES)) raw[field] = 1e6;
    const spec = PLATE_REVERB_INSERT.normalise(raw, 'x', n);
    for (const [field, [, max]] of Object.entries(REVERB_SPACE_RANGES)) {
      expect(spec[field as keyof typeof REVERB_SPACE_RANGES], field).toBe(max);
    }
    expect(spec.mix).toBe(1);
    expect(n.corrections[0]).toBe('x.fuzz: unknown key dropped');
    expect(n.corrections).toContain('x.mix: clamped 2 to 1');
    expect(n.corrections).toHaveLength(Object.keys(REVERB_SPACE_RANGES).length + 2);
  });

  it('loads a spec with no `enabled` as on', () => {
    const n = new FieldNormaliser();
    expect(PLATE_REVERB_INSERT.normalise({ kind: 'plate', mix: 0.5 }, 'x', n)).toEqual({
      ...DEFAULT_PLATE_REVERB,
      mix: 0.5,
    });
    expect(n.corrections).toEqual([]);
  });
});
