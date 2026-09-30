/**
 * A part strip's peak meter (windsor#155), run through the real generated
 * meter processor on the headless graph: lazy until `setActive(true)`, it
 * reads the rotation's output — post-fader, post-gate, post-pan — latches
 * overload at full scale until `reset()`, and goes with the strip.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { tones } from '../__fixtures__/audioAnalysis';
import type { FakeContext, FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { renderGraph } from '../__fixtures__/fakeAudioContext';
import { STRIP, fake, installWorklet, rig, sources } from '../__fixtures__/stripRig';
import type { ChannelStrip } from './mix';
import { RETURNS } from './mix';
import type { PartStrip } from './channelStrip';
import { routePart } from './channelStrip';
import { PEAK_METER_NAME } from './peakMeterConstants';
import { createReturns } from './returnBus';

const undo = installWorklet();
afterAll(undo);

/** Long enough for several of the meter's 30 Hz reports. */
const SECONDS = 0.1;
const AMPLITUDE = 0.4;
const HZ = 440;
/** Over full scale: a sine's samples need not land on its exact crest. */
const OVER = 1.25;
/** The meter's float32 peak against the captured float32 peak. */
const CLOSE = 6;

async function metered(
  strip: Partial<ChannelStrip> = {},
  amplitude = AMPLITUDE,
): Promise<{ context: FakeContext; routed: PartStrip }> {
  const { context, part, dry } = await rig();
  await context.audioWorklet.addModule('peak-meter-processor.js');
  (part.node as unknown as { feed: unknown }).feed = tones(HZ, HZ, amplitude);
  const returns = createReturns(context.asAudioContext(), RETURNS, dry);
  const routed = routePart(part, { ...STRIP, pan: 0, ...strip }, returns, dry);
  return { context, routed };
}

const meters = (context: FakeContext): FakeWorkletNode[] =>
  context.workletNodes.filter((node) => node.name === PEAK_METER_NAME);

const peak = (samples: Float32Array): number =>
  samples.reduce((max, x) => Math.max(max, Math.abs(x)), 0);

/** Render, then the meter's held peak on each side. */
function peaks(context: FakeContext, routed: PartStrip): [number, number] {
  renderGraph(context, SECONDS);
  const { holdLeft, holdRight } = routed.meter.read();
  return [holdLeft, holdRight];
}

describe('a part strip’s peak meter', () => {
  it('builds nothing until it is made active, then taps the rotation’s output', async () => {
    const { context, routed } = await metered();
    expect(meters(context)).toEqual([]);
    routed.meter.setActive(true);
    const [node] = meters(context);
    expect(meters(context)).toHaveLength(1);
    expect(sources(node as unknown as AudioNode)).toEqual([fake(routed.rotation.output)]);
    routed.meter.setActive(false);
    expect(node!.inbound).toEqual([]);
  });

  it('reads the post-fader, post-pan peak: level raises it, pan moves it', async () => {
    /** The meter's held peaks, and the peaks of the rotation's output over the same render. */
    const reading = async (strip: Partial<ChannelStrip>): Promise<[number, number]> => {
      const { context, routed } = await metered(strip);
      routed.meter.setActive(true);
      const [out] = renderGraph(context, SECONDS, [fake(routed.rotation.output)]);
      const { holdLeft, holdRight } = routed.meter.read();
      expect(holdLeft).toBeCloseTo(peak(out!.left), CLOSE);
      expect(holdRight).toBeCloseTo(peak(out!.right), CLOSE);
      return [holdLeft, holdRight];
    };
    const [left, right] = await reading({ level: 1 });
    expect(left).toBeGreaterThan(AMPLITUDE / 2);
    expect(right).toBeCloseTo(left, CLOSE);
    const [quiet] = await reading({ level: 0.5 });
    expect(quiet).toBeCloseTo(left / 2, CLOSE);
    // Hard right rotates a centred part fully into the right, √2 louder there.
    const [panLeft, panRight] = await reading({ level: 1, pan: 1 });
    expect(panLeft).toBeCloseTo(0, CLOSE);
    expect(panRight).toBeCloseTo(left * Math.SQRT2, CLOSE);
  });

  it('reads silence from a muted or soloed-out part', async () => {
    const muted = await metered();
    muted.routed.meter.setActive(true);
    muted.routed.setMute(true);
    expect(peaks(muted.context, muted.routed)).toEqual([0, 0]);

    const soloedOut = await metered();
    soloedOut.routed.meter.setActive(true);
    soloedOut.routed.setSoloedOut(true, 0);
    expect(peaks(soloedOut.context, soloedOut.routed)).toEqual([0, 0]);
    soloedOut.routed.setSoloedOut(false, 0);
    expect(peaks(soloedOut.context, soloedOut.routed)[0]).toBeGreaterThan(0);
  });

  it('latches overload at full scale until reset', async () => {
    const { context, routed } = await metered({ level: 1 }, OVER);
    routed.meter.setActive(true);
    renderGraph(context, SECONDS);
    expect(routed.meter.read().overload).toBe(true);
    routed.setLevel(AMPLITUDE);
    renderGraph(context, SECONDS);
    expect(routed.meter.read().overload).toBe(true);
    routed.meter.reset();
    renderGraph(context, SECONDS);
    expect(routed.meter.read().overload).toBe(false);
  });

  it('goes with the strip, and cannot be made active after', async () => {
    const { context, routed } = await metered();
    routed.meter.setActive(true);
    const [node] = meters(context);
    routed.dispose();
    expect(node!.inbound).toEqual([]);
    expect(node!.posted).toContainEqual({ type: 'stop' });
    routed.meter.setActive(true);
    expect(meters(context)).toHaveLength(1);
  });
});
