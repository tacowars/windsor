/**
 * The strip is a chain with one tap point (#639): whatever stages it carries,
 * the rotation and every send hang off the last one, so a room hears what the
 * dry path hears. With no stages the graph is #68's, edge for edge.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { rms, tones } from './__fixtures__/audioAnalysis';
import { FakeContext, installFakeAudioWorklet, renderGraph } from './__fixtures__/fakeAudioContext';
import type { FakeNode } from './__fixtures__/fakeAudioNodes';
import { AudioPart } from './audioPart';
import type { StripStage } from './channelStrip';
import { routePart } from './channelStrip';
import type { ChannelStrip } from './mix';
import { RETURNS, RETURN_NAMES } from './mix';
import { makePatch } from './patch';
import { createReturns } from './returnBus';
import { PROCESSOR_NAME } from './workletMessages';

const undo = installFakeAudioWorklet();
afterAll(undo);

const STRIP: ChannelStrip = { level: 1, pan: 0.4, sends: { room: 0.5, echo: 0.25 } };
const STAGE_GAIN = 0.5;
const SECONDS = 0.25;
const AMPLITUDE = 0.4;

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

/** A stage that scales by `gain`: two gains in series, so input and output differ. */
function scaleStage(context: FakeContext, gain: number): StripStage & { disposed: number } {
  const input = context.createGain();
  const output = context.createGain();
  output.gain.value = gain;
  input.connect(output);
  const stage = {
    input: input as unknown as AudioNode,
    output: output as unknown as AudioNode,
    disposed: 0,
    dispose(): void {
      stage.disposed++;
      input.disconnect();
    },
  };
  return stage;
}

describe('routePart with no stages', () => {
  it('taps part.output for the rotation and one send per return, as #68 built it', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const strip = routePart(part, STRIP, returns, dry);

    expect(strip.tail).toBe(part.output);
    expect(strip.stages).toEqual([]);
    const sends = RETURN_NAMES.map((name) => strip.sends.get(name));
    expect(targets(part.output)).toEqual([
      fake(strip.rotation.input),
      ...sends.map((s) => fake(s!)),
    ]);
    for (const name of RETURN_NAMES) {
      const send = strip.sends.get(name)!;
      expect(targets(send)).toEqual([fake(returns[name].input)]);
      expect(send.gain.value).toBe(STRIP.sends[name] ?? 0);
    }
    expect(targets(strip.rotation.output)).toEqual([fake(dry)]);
  });

  it('leaves part.output with no connection once disposed', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    routePart(part, STRIP, returns, dry).dispose();
    expect(targets(part.output)).toEqual([]);
  });
});

describe('routePart with a stage', () => {
  it('feeds the stage from part.output and taps the rotation and every send from its output', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const stage = scaleStage(context, STAGE_GAIN);
    const strip = routePart(part, STRIP, returns, dry, [stage]);

    expect(strip.tail).toBe(stage.output);
    expect(targets(part.output)).toEqual([fake(stage.input)]);
    expect(sources(strip.rotation.input)).toEqual([fake(stage.output)]);
    for (const send of strip.sends.values()) expect(sources(send)).toEqual([fake(stage.output)]);
  });

  it('chains several stages in order', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const first = scaleStage(context, 1);
    const second = scaleStage(context, 1);
    const strip = routePart(part, STRIP, returns, dry, [first, second]);

    expect(targets(part.output)).toEqual([fake(first.input)]);
    expect(targets(first.output)).toEqual([fake(second.input)]);
    expect(strip.tail).toBe(second.output);
  });

  it('puts the stage in front of the room as well as the dry path', async () => {
    const levels = async (stages: (c: FakeContext) => StripStage[]): Promise<number[]> => {
      const { context, part, dry } = await rig();
      (part.node as unknown as { feed: unknown }).feed = tones(440, 660, AMPLITUDE);
      const returns = createReturns(context.asAudioContext(), RETURNS, dry);
      const strip = routePart(part, STRIP, returns, dry, stages(context));
      const taps = [fake(strip.rotation.output), fake(strip.sends.get('room')!)];
      return renderGraph(context, SECONDS, taps).map((c) => rms(c.left) + rms(c.right));
    };
    const [plainDry, plainSend] = await levels(() => []);
    const [stagedDry, stagedSend] = await levels((c) => [scaleStage(c, STAGE_GAIN)]);
    expect(plainDry).toBeGreaterThan(0);
    expect(stagedDry! / plainDry!).toBeCloseTo(STAGE_GAIN, 6);
    expect(stagedSend! / plainSend!).toBeCloseTo(STAGE_GAIN, 6);
  });

  it('removes every edge it made on dispose, and disposes each stage once', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const first = scaleStage(context, 1);
    const second = scaleStage(context, 1);
    const strip = routePart(part, STRIP, returns, dry, [first, second]);
    strip.dispose();

    expect(targets(part.output)).toEqual([]);
    expect(targets(first.output)).toEqual([]);
    expect(targets(second.output)).toEqual([]);
    expect(first.disposed).toBe(1);
    expect(second.disposed).toBe(1);
    for (const send of strip.sends.values()) expect(sources(send)).toEqual([]);
  });
});
