/**
 * The strip is a chain with one tap point (#639): the low cut first (#640),
 * then the strip's inserts from the registry (#641), and the rotation and every send hang
 * off the last one — so a room hears what the dry path hears.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { rms, tones } from './__fixtures__/audioAnalysis';
import type { Capture } from './__fixtures__/fakeAudioContext';
import { FakeContext, installFakeAudioWorklet, renderGraph } from './__fixtures__/fakeAudioContext';
import type { FakeGain, FakeNode } from './__fixtures__/fakeAudioNodes';
import { LOW_CUT_MIN_HZ } from './audioConstants';
import { AudioPart } from './audioPart';
import { routePart } from './channelStrip';
import type { InsertKind, InsertRegistry, InsertSpec, InsertStage } from './inserts/insertRegistry';
import type { ChannelStrip } from './mix';
import { RETURNS, RETURN_NAMES } from './mix';
import { makePatch } from './patch';
import { createReturns } from './returnBus';
import { PROCESSOR_NAME } from './workletMessages';

const undo = installFakeAudioWorklet();
afterAll(undo);

const STRIP: ChannelStrip = {
  level: 1,
  pan: 0.4,
  lowCut: LOW_CUT_MIN_HZ,
  sends: { room: 0.5, echo: 0.25 },
  inserts: [],
};
const STAGE_GAIN = 0.5;
const SECONDS = 0.25;
const AMPLITUDE = 0.4;
const CUT_HZ = 300;
/** Two octaves under the cut: a 12 dB/octave highpass leaves −24 dB there. */
const BELOW_CUT_HZ = CUT_HZ / 4;
const ABOVE_CUT_HZ = CUT_HZ * 10;
/** A quarter of the level is −12 dB, well short of the −24 expected. */
const CUT_RATIO_MAX = 0.25;
const PASS_RATIO_MIN = 0.99;

const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
const targets = (node: AudioNode): FakeNode[] => fake(node).outbound.map((c) => c.to);
const sources = (node: AudioNode): FakeNode[] => fake(node).inbound.map((c) => c.from);

async function rig(): Promise<{ context: FakeContext; part: AudioPart; dry: AudioNode }> {
  const context = new FakeContext();
  await context.audioWorklet.addModule('fm-processor.js');
  await context.audioWorklet.addModule('reverb-processor.js');
  const ctx = context.asAudioContext();
  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, { numberOfInputs: 0 });
  const part = new AudioPart('lead', node, makePatch());
  const dry = context.createGain();
  dry.connect(context.destination);
  return { context, part, dry: dry as unknown as AudioNode };
}

interface ScaleSpec {
  readonly kind: 'scale' | 'boost';
  readonly gain: number;
}

/** What the test kinds built, so a test can count creations and disposals. */
const built: (InsertStage<ScaleSpec> & { disposed: number; sets: number })[] = [];

/** A test insert kind that scales by `gain`: two gains in series, so input and output differ. */
function scaleKind(kind: ScaleSpec['kind']): InsertKind<ScaleSpec> {
  return {
    fields: ['kind', 'gain'],
    defaults: { kind, gain: 1 },
    normalise: (raw) => ({ kind, gain: Number(raw.gain) }),
    create(context, spec) {
      const input = context.createGain();
      const output = context.createGain();
      output.gain.value = spec.gain;
      input.connect(output);
      const stage = {
        kind,
        input,
        output,
        disposed: 0,
        sets: 0,
        set(next: ScaleSpec): void {
          stage.sets++;
          output.gain.value = next.gain;
        },
        dispose(): void {
          stage.disposed++;
          input.disconnect();
        },
      };
      built.push(stage);
      return stage;
    },
  };
}

const TEST_KINDS = {
  scale: scaleKind('scale'),
  boost: scaleKind('boost'),
} as unknown as InsertRegistry;
const scale = (gain: number): InsertSpec => ({ kind: 'scale', gain }) as unknown as InsertSpec;
const boost = (gain: number): InsertSpec => ({ kind: 'boost', gain }) as unknown as InsertSpec;

/** Summed left and right RMS over the second half, past any filter transient. */
function settled(capture: Capture | undefined, sampleRate: number): number {
  if (!capture) throw new Error('render produced no capture');
  const half = Math.round((SECONDS * sampleRate) / 2);
  return rms(capture.left, half) + rms(capture.right, half);
}

describe('routePart with no inserts', () => {
  it('feeds the low cut from part.output and taps the rotation and every send from it', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const strip = routePart(part, { ...STRIP, lowCut: CUT_HZ }, returns, dry);

    expect(strip.stages).toEqual([strip.lowCut]);
    expect(strip.inserts).toEqual([]);
    expect(strip.tail).toBe(strip.lowCut.output);
    expect(strip.lowCut.filter.frequency.value).toBe(CUT_HZ);
    expect(targets(part.output)).toEqual([fake(strip.lowCut.input)]);
    const sends = RETURN_NAMES.map((name) => fake(strip.sends.get(name)!));
    expect(targets(strip.tail)).toEqual([fake(strip.rotation.input), ...sends]);
    for (const name of RETURN_NAMES) {
      const send = strip.sends.get(name)!;
      expect(targets(send)).toEqual([fake(returns[name].input)]);
      expect(send.gain.value).toBe(STRIP.sends[name] ?? 0);
    }
    expect(targets(strip.rotation.output)).toEqual([fake(dry)]);
  });

  it('moves the cutoff live, with no change to the graph', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const strip = routePart(part, STRIP, returns, dry);
    const before = context.nodes.map((n) => [...n.outbound]);
    strip.setLowCut(CUT_HZ);
    expect(strip.lowCut.filter.frequency.value).toBe(CUT_HZ);
    expect(context.nodes.map((n) => [...n.outbound])).toEqual(before);
  });

  it('cuts the low end of the dry path and of the room send alike', async () => {
    const ratios = async (hz: number): Promise<{ dry: number; send: number }> => {
      const level = async (lowCut: number): Promise<number[]> => {
        const { context, part, dry } = await rig();
        (part.node as unknown as { feed: unknown }).feed = tones(hz, hz, AMPLITUDE);
        const returns = createReturns(context.asAudioContext(), RETURNS, dry);
        const strip = routePart(part, { ...STRIP, lowCut }, returns, dry);
        const taps = [fake(strip.rotation.output), fake(strip.sends.get('room')!)];
        return renderGraph(context, SECONDS, taps).map((c) => settled(c, context.sampleRate));
      };
      const [openDry, openSend] = await level(LOW_CUT_MIN_HZ);
      const [cutDry, cutSend] = await level(CUT_HZ);
      return { dry: cutDry! / openDry!, send: cutSend! / openSend! };
    };
    const low = await ratios(BELOW_CUT_HZ);
    expect(low.dry).toBeLessThan(CUT_RATIO_MAX);
    expect(low.send).toBeLessThan(CUT_RATIO_MAX);
    const high = await ratios(ABOVE_CUT_HZ);
    expect(high.dry).toBeGreaterThan(PASS_RATIO_MIN);
    expect(high.send).toBeGreaterThan(PASS_RATIO_MIN);
  });

  it('leaves part.output with no connection once disposed', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    routePart(part, STRIP, returns, dry).dispose();
    expect(targets(part.output)).toEqual([]);
  });
});

describe('routePart with inserts', () => {
  it('puts an insert after the low cut and taps the rotation and every send from its output', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const strip = routePart(
      part,
      { ...STRIP, inserts: [scale(STAGE_GAIN)] },
      returns,
      dry,
      TEST_KINDS,
    );
    const [insert] = strip.inserts;

    expect(strip.tail).toBe(insert?.output);
    expect(targets(part.output)).toEqual([fake(strip.lowCut.input)]);
    expect(targets(strip.lowCut.output)).toEqual([fake(insert!.input)]);
    expect(sources(strip.rotation.input)).toEqual([fake(insert!.output)]);
    for (const send of strip.sends.values()) expect(sources(send)).toEqual([fake(insert!.output)]);
  });

  it('chains several inserts in list order, after the low cut', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const strip = routePart(
      part,
      { ...STRIP, inserts: [scale(1), boost(1)] },
      returns,
      dry,
      TEST_KINDS,
    );
    const [first, second] = strip.inserts;

    expect(strip.inserts.map((i) => i.kind)).toEqual(['scale', 'boost']);
    expect(strip.stages).toEqual([strip.lowCut, first, second]);
    expect(targets(strip.lowCut.output)).toEqual([fake(first!.input)]);
    expect(targets(first!.output)).toEqual([fake(second!.input)]);
    expect(strip.tail).toBe(second!.output);
  });

  it('puts the insert in front of the room as well as the dry path', async () => {
    const levels = async (inserts: InsertSpec[]): Promise<number[]> => {
      const { context, part, dry } = await rig();
      (part.node as unknown as { feed: unknown }).feed = tones(440, 660, AMPLITUDE);
      const returns = createReturns(context.asAudioContext(), RETURNS, dry);
      const strip = routePart(part, { ...STRIP, inserts }, returns, dry, TEST_KINDS);
      const taps = [fake(strip.rotation.output), fake(strip.sends.get('room')!)];
      return renderGraph(context, SECONDS, taps).map((c) => settled(c, context.sampleRate));
    };
    const [plainDry, plainSend] = await levels([]);
    const [stagedDry, stagedSend] = await levels([scale(STAGE_GAIN)]);
    expect(plainDry).toBeGreaterThan(0);
    expect(stagedDry! / plainDry!).toBeCloseTo(STAGE_GAIN, 6);
    expect(stagedSend! / plainSend!).toBeCloseTo(STAGE_GAIN, 6);
  });

  it('sets the same kinds in the same order on the live stages, with no change to the graph', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const strip = routePart(
      part,
      { ...STRIP, inserts: [scale(1), boost(1)] },
      returns,
      dry,
      TEST_KINDS,
    );
    const live = [...strip.inserts];
    const before = context.nodes.map((n) => [...n.outbound]);
    strip.setInserts([scale(STAGE_GAIN), boost(2)]);
    expect(strip.inserts).toEqual(live);
    expect(context.nodes.map((n) => [...n.outbound])).toEqual(before);
    expect((live[0]!.output as unknown as FakeGain).gain.value).toBe(STAGE_GAIN);
    expect((live[1]!.output as unknown as FakeGain).gain.value).toBe(2);
    expect((live as unknown as (typeof built)[number][]).map((i) => i.sets)).toEqual([1, 1]);
  });

  it('rebuilds only its own insert chain for a new list, and re-taps the tail', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const strip = routePart(part, { ...STRIP, inserts: [scale(1)] }, returns, dry, TEST_KINDS);
    const old = strip.inserts[0] as unknown as (typeof built)[number];
    const rotationSplitter = fake(strip.rotation.input);

    strip.setInserts([boost(1), scale(1)]);
    const [first, second] = strip.inserts;
    expect(old.disposed).toBe(1);
    expect(strip.inserts.map((i) => i.kind)).toEqual(['boost', 'scale']);
    expect(targets(strip.lowCut.output)).toEqual([fake(first!.input)]);
    expect(targets(old.output)).toEqual([]);
    expect(strip.tail).toBe(second!.output);
    expect(sources(strip.rotation.input)).toEqual([fake(second!.output)]);
    for (const send of strip.sends.values()) expect(sources(send)).toEqual([fake(second!.output)]);
    // The strip's own nodes downstream of the tail are the ones it started with.
    expect(fake(strip.rotation.input)).toBe(rotationSplitter);

    strip.setInserts([]);
    expect(strip.tail).toBe(strip.lowCut.output);
    expect(sources(strip.rotation.input)).toEqual([fake(strip.lowCut.output)]);
  });

  it('refuses a kind the registry lacks before touching the graph', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const strip = routePart(part, { ...STRIP, inserts: [scale(1)] }, returns, dry, TEST_KINDS);
    const before = context.nodes.map((n) => [...n.outbound]);
    expect(() => strip.setInserts([{ kind: 'fuzz' } as unknown as InsertSpec])).toThrow(/fuzz/);
    expect(context.nodes.map((n) => [...n.outbound])).toEqual(before);
  });

  it('removes every edge it made on dispose, and disposes each insert once', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const strip = routePart(
      part,
      { ...STRIP, inserts: [scale(1), boost(1)] },
      returns,
      dry,
      TEST_KINDS,
    );
    const [first, second] = strip.inserts as unknown as (typeof built)[number][];
    strip.dispose();

    expect(targets(part.output)).toEqual([]);
    expect(targets(strip.lowCut.output)).toEqual([]);
    expect(targets(first!.output)).toEqual([]);
    expect(targets(second!.output)).toEqual([]);
    expect(first!.disposed).toBe(1);
    expect(second!.disposed).toBe(1);
    for (const send of strip.sends.values()) expect(sources(send)).toEqual([]);
  });
});
