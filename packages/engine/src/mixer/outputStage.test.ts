/**
 * The output stage's node wrapper (windsor#93) over the headless graph,
 * which runs the real generated processor: settings in place, latency,
 * reports and disposal.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { AudioLoadMeter, meterNode } from '../cost/audioLoad';

import type { FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import {
  FakeContext,
  installFakeAudioWorklet,
  renderGraph,
} from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { FakeConstantSource } from '../__fixtures__/fakeOscillator';
import { OUTPUT_STAGE_WORKLET_URL, createOutputStage } from './outputStage';
import type { OutputStageReport } from './outputStageConstants';
import { dbToGain } from './outputStageDsp';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

async function stage(initial?: Parameters<typeof createOutputStage>[1]) {
  const context = new FakeContext();
  await context.audioWorklet.addModule(String(OUTPUT_STAGE_WORKLET_URL));
  const out = createOutputStage(context.asAudioContext(), initial);
  const node = out.node as unknown as FakeWorkletNode;
  const source = new FakeConstantSource(context);
  source.offset.value = 2;
  source.start();
  (source as unknown as AudioNode).connect(out.node);
  out.node.connect(context.destination as unknown as AudioNode);
  return { context, out, node, source };
}

const value = (node: FakeWorkletNode, name: string): number => node.parameters.get(name)!.value;

describe('createOutputStage', () => {
  it('starts on the settings it is given, as the processor parameters', async () => {
    const { out, node } = await stage({ mode: 'hard', ceilingDb: -6, lookahead: true });
    expect([value(node, 'mode'), value(node, 'ceilingDb'), value(node, 'lookahead')]).toEqual([
      2, -6, 1,
    ]);
    expect(out.settings).toEqual({ mode: 'hard', ceilingDb: -6, lookahead: true });
    expect(out.latencyFrames).toBe(15);
  });

  it('changes mode, ceiling and lookahead in place, on the same node', async () => {
    const { context, out, node } = await stage();
    expect(out.latencyFrames).toBe(0);
    const [before] = renderGraph(context, 0.05, [node as unknown as FakeNode]);
    expect(Math.max(...before!.left)).toBeCloseTo(Math.fround(dbToGain(-1)), 6);
    out.set({ mode: 'limiter', ceilingDb: -6, lookahead: true });
    expect(out.node).toBe(node);
    expect(out.latencyFrames).toBe(72);
    const [after] = renderGraph(context, 0.05, [node as unknown as FakeNode]);
    expect(Math.max(...after!.left.subarray(200))).toBeCloseTo(Math.fround(dbToGain(-6)), 6);
    out.set({ mode: 'off', ceilingDb: -6, lookahead: true });
    expect(out.latencyFrames).toBe(0);
    const [off] = renderGraph(context, 0.01, [node as unknown as FakeNode]);
    expect(off!.left.every((v) => v === 2)).toBe(true);
  });

  it('hands on every report, and reads the latest', async () => {
    const { context, out } = await stage();
    expect(out.read()).toMatchObject({ type: 'outputStage', active: false });
    const seen: OutputStageReport[] = [];
    const stop = out.subscribe((report) => seen.push({ ...report }));
    renderGraph(context, 0.2);
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(out.revision).toBe(seen.length);
    expect(out.read()).toMatchObject({ inputLeft: 2, active: true });
    expect(out.read().reductionDb).toBeCloseTo(-20 * Math.log10(Math.fround(dbToGain(-1)) / 2), 3);
    stop();
    renderGraph(context, 0.1);
    expect(out.revision).toBeGreaterThan(seen.length);
  });

  it('stops the processor and disconnects on dispose', async () => {
    const { out, node } = await stage();
    out.dispose();
    expect(node.posted).toContainEqual({ type: 'stop' });
    expect(node.outbound).toEqual([]);
    const before = out.revision;
    node.port.dispatchEvent(new MessageEvent('message', { data: { type: 'outputStage' } }));
    expect(out.revision).toBe(before);
  });

  it('keeps its reports when the load meter takes the port, and sends the meter its load', async () => {
    const { context, out, node } = await stage();
    const meter = new AudioLoadMeter(() => 0);
    meterNode(meter, 'outputStage', out.node, context.sampleRate, 0.01);
    expect(node.posted).toContainEqual({ type: 'reportLoad', quanta: expect.any(Number) });
    renderGraph(context, 0.2);
    expect(out.revision).toBeGreaterThanOrEqual(5);
    expect(meter.readout().processors).toBe(1);
  });
});
