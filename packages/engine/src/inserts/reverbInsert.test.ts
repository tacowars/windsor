/**
 * The Reverb insert (windsor#171, windsor#771) is the `room` return's plate on a
 * strip: at Mix 1 in the hall space it renders what the return renders, at
 * Mix 0 or switched off it passes its input unchanged, and a settings change
 * is param writes on one fixed graph. Its Mix is equal-power (windsor#748).
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
import { KICK, song } from '../__fixtures__/documentCases';
import { ARRANGEMENT_VERSION, REVERB_SPACE_RANGES } from '../audioConstants';
import { PLATE_FULLY_WET, createPlate } from '../mixer/returnEffects';
import { SPACE_ROWS } from '../__fixtures__/reverbSpaceFixtures';
import { makeArrangement } from '../song/arrangementDocument';
import { FieldNormaliser } from '../song/arrangementFields';
import { PROCESSOR_NAME, REVERB_PROCESSOR_NAME } from '../synth/workletMessages';
import type { ReverbInsertSpec } from './reverbInsert';
import { DEFAULT_REVERB, REVERB_INSERT, plateMix, plateSpace } from './reverbInsert';

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

async function renderStage(spec: ReverbInsertSpec): Promise<{ input: Capture; output: Capture }> {
  const { context: c, source } = await context();
  const stage = REVERB_INSERT.create(c.asAudioContext(), spec);
  source.connect(fake(stage.input));
  fake(stage.output).connect(c.destination);
  const [input, output] = renderGraph(c, SECONDS, [source, fake(stage.output)]);
  if (!input || !output) throw new Error('render produced no captures');
  return { input, output };
}

describe('the Reverb insert sound', () => {
  it("renders the room return's plate exactly at Mix 1 in the hall space", async () => {
    const { output } = await renderStage({ ...DEFAULT_REVERB, mix: 1 });

    const { context: c, source } = await context();
    // The room return's plate, as it was built before windsor#172.
    const plate = createPlate(c.asAudioContext(), SPACE_ROWS.hall, PLATE_FULLY_WET);
    source.connect(fake(plate));
    const [returned] = renderGraph(c, SECONDS, [fake(plate)]);

    expect(rms(output.left, Math.round(TAIL_FROM_SECONDS * c.sampleRate))).toBeGreaterThan(0);
    expect(output.left).toEqual(returned?.left);
    expect(output.right).toEqual(returned?.right);
  });

  it('passes the input through dry at Mix 0', async () => {
    const { input, output } = await renderStage({ ...DEFAULT_REVERB, mix: 0 });
    expect(output.left).toEqual(input.left);
    expect(output.right).toEqual(input.right);
  });

  it('passes the input through unchanged when switched off', async () => {
    const { input, output } = await renderStage({ ...DEFAULT_REVERB, enabled: false });
    expect(output.left).toEqual(input.left);
    expect(output.right).toEqual(input.right);
  });

  it('adds a tail past the input at its default Mix', async () => {
    const { input, output } = await renderStage(DEFAULT_REVERB);
    const tail = Math.round(TAIL_FROM_SECONDS * 48000);
    expect(rms(input.left, tail)).toBe(0);
    expect(rms(output.left, tail)).toBeGreaterThan(0);
  });
});

describe('the Reverb insert graph', () => {
  it('drives the processor with its space and Mix as the plate’s own wet and dry', async () => {
    const { context: c } = await context();
    const stage = REVERB_INSERT.create(c.asAudioContext(), DEFAULT_REVERB);
    const plate = c.workletNodes.find((n) => n.name === REVERB_PROCESSOR_NAME);
    expect(stage.processor).toBe(plate);
    const { wet, dry } = plateMix(DEFAULT_REVERB);
    expect(plate?.parameters.get('wet')?.value).toBeCloseTo(wet, 6);
    expect(plate?.parameters.get('dry')?.value).toBeCloseTo(dry, 6);
    expect(plate?.parameters.get('size')?.value).toBe(SPACE_ROWS.hall.size);
  });

  it('takes new settings as param writes, with no change to the graph', async () => {
    const { context: c } = await context();
    const stage = REVERB_INSERT.create(c.asAudioContext(), DEFAULT_REVERB);
    const before = c.nodes.map((n) => [...n.outbound]);
    stage.set({ ...DEFAULT_REVERB, ...SPACE_ROWS.cathedral, mix: 0.8, enabled: false });
    expect(c.nodes.map((n) => [...n.outbound])).toEqual(before);
    const plate = c.workletNodes.find((n) => n.name === REVERB_PROCESSOR_NAME);
    expect(plate?.parameters.get('size')?.value).toBe(SPACE_ROWS.cathedral.size);
    expect(plate?.parameters.get('wet')?.value).toBeCloseTo(Math.sin(0.4 * Math.PI), 6);
  });

  it('disconnects what it built and leaves the edge out of its output to the strip', async () => {
    const { context: c } = await context();
    const stage = REVERB_INSERT.create(c.asAudioContext(), DEFAULT_REVERB);
    const next = c.createGain();
    fake(stage.output).connect(next);
    stage.dispose();
    expect(c.nodes.filter((n) => n !== fake(stage.output) && n.outbound.length > 0)).toEqual([]);
    expect(fake(stage.output).outbound.map((conn) => conn.to)).toEqual([next]);
  });
});

describe('plateMix (windsor#748)', () => {
  it.each([
    [0, 0, 1],
    [0.5, 0.7071, 0.7071],
    [1, 1, 0],
  ])('is equal-power: Mix %f is wet %f and dry %f', (mix, wet, dry) => {
    const gains = plateMix({ ...DEFAULT_REVERB, mix });
    expect(gains.wet).toBeCloseTo(wet, 4);
    expect(gains.dry).toBeCloseTo(dry, 4);
  });

  it('keeps its ends exact', () => {
    expect(plateMix({ ...DEFAULT_REVERB, mix: 0 })).toEqual({ wet: 0, dry: 1 });
    expect(plateMix({ ...DEFAULT_REVERB, mix: 1 })).toEqual({ wet: 1, dry: 0 });
  });
});

describe('REVERB_INSERT', () => {
  it('starts in the hall space at Mix 0.30, switched on', () => {
    expect(plateSpace(DEFAULT_REVERB)).toEqual(SPACE_ROWS.hall);
    expect(DEFAULT_REVERB.mix).toBe(0.3);
    expect(DEFAULT_REVERB.enabled).toBe(true);
  });

  it('clamps every number to its range and reports unknown keys', () => {
    const n = new FieldNormaliser();
    const raw: Record<string, unknown> = { kind: 'reverb', fuzz: 1, mix: 2 };
    for (const field of Object.keys(REVERB_SPACE_RANGES)) raw[field] = 1e6;
    const spec = REVERB_INSERT.normalise(raw, 'x', n);
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
    expect(REVERB_INSERT.normalise({ kind: 'reverb', mix: 0.5 }, 'x', n)).toEqual({
      ...DEFAULT_REVERB,
      mix: 0.5,
    });
    expect(n.corrections).toEqual([]);
  });
});

describe('a version-15 song (windsor#748, windsor#761, windsor#764, windsor#746, windsor#771)', () => {
  const room = {
    kind: 'reverb',
    decay: 12.5,
    lowDecay: 2.5,
    lowCross: 4000,
    build: 0.85,
    modRate: 6.5,
    modDepth: 3.25,
    voicing: 'room',
    mix: 1,
  };
  const strip = {
    kind: 'reverb',
    decay: 0.35,
    lowDecay: 0.3,
    lowCross: 120,
    build: 0,
    modRate: 0.25,
    modDepth: 0.15,
    voicing: 'room',
    mix: 0.6,
  };

  it('round-trips decay, lowDecay, lowCross, build, modRate, modDepth and voicing on Send A, a group and a part', () => {
    const raw = {
      ...song([{ ...KICK, strip: { inserts: [strip] } }]),
      returns: { a: { inserts: [room] } },
      groups: [{ id: 0, inserts: [strip] }],
    };
    const first = makeArrangement(raw);
    expect(first.corrections).toEqual([]);
    expect(first.document.version).toBe(ARRANGEMENT_VERSION);
    expect(first.document.returns?.a?.inserts[0]).toMatchObject(room);
    expect(first.document.groups?.[0]?.inserts[0]).toMatchObject(strip);
    expect(first.document.parts[0]!.strip!.inserts[0]).toMatchObject(strip);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });

  it('loads a plate with no voicing as plate-voiced, on a return and on a Reverb insert, with no correction', () => {
    const bare = (spec: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(spec).filter(([field]) => field !== 'voicing'));
    const [bareRoom, bareStrip] = [bare(room), bare(strip)];
    const raw = {
      ...song([{ ...KICK, strip: { inserts: [bareStrip] } }]),
      returns: { a: { inserts: [bareRoom] } },
    };
    const result = makeArrangement(raw);
    expect(result.corrections).toEqual([]);
    expect(result.document.returns?.a?.inserts[0]).toMatchObject({ voicing: 'plate' });
    expect(result.document.parts[0]!.strip!.inserts[0]).toMatchObject({ voicing: 'plate' });
  });

  it('replaces a voicing it does not know with the plate, and says so', () => {
    const n = new FieldNormaliser();
    const spec = REVERB_INSERT.normalise({ kind: 'reverb', voicing: 'hall' }, 'x', n);
    expect(spec.voicing).toBe('plate');
    expect(n.corrections).toHaveLength(1);
  });

  it('refuses a version-14 song with the format message, never loading its `plate` kind', () => {
    const plate = { ...room, kind: 'plate' };
    const raw = { ...song([KICK]), returns: { a: { inserts: [plate] } }, version: 14 };
    const result = makeArrangement(raw);
    expect(result.usable).toBe(false);
    expect(result.refused?.message).toBe(
      `saved with song format 14, this build reads ${ARRANGEMENT_VERSION}`,
    );
  });

  it('reports a current song naming the old `plate` kind as dangling, as any unknown kind (windsor#771)', () => {
    const result = makeArrangement({
      ...song([KICK]),
      returns: { a: { inserts: [{ ...room, kind: 'plate' }] } },
    });
    expect(result.document.returns?.a?.inserts).toEqual([]);
    expect(result.dangling).toEqual([
      'returns.a.inserts[0].kind: no insert kind "plate" is defined',
    ]);
  });
});
