/** The optional meter owns only its tap, including late reports and disposal (#666). */
import { afterEach, expect, it, vi } from 'vitest';
import { FakeContext } from '../__fixtures__/fakeAudioContext';
import { FakeGain } from '../__fixtures__/fakeAudioNodes';
import { createPeakMeter } from './peakMeter';
import type { PeakReport } from './peakMeterConstants';
afterEach(() => vi.unstubAllGlobals());
it('creates one silent tap only while active, ignores late messages and cannot restart after disposal', () => {
  const nodes: Node[] = [];
  class Node extends FakeGain {
    port = {
      postMessage: vi.fn(),
      close: vi.fn(),
      onmessage: null as ((event: MessageEvent<PeakReport>) => void) | null,
    };
    constructor(context: FakeContext) {
      super(context);
      nodes.push(this);
    }
  }
  vi.stubGlobal('AudioWorkletNode', Node);
  const context = new FakeContext();
  const source = context.createGain();
  source.connect(context.destination);
  const meter = createPeakMeter(context.asAudioContext(), source as unknown as AudioNode);
  expect(nodes).toHaveLength(0);
  meter.setActive(true);
  meter.setActive(true);
  expect(nodes).toHaveLength(1);
  const node = nodes[0]!;
  const receive = node.port.onmessage!;
  const peaks: PeakReport = {
    type: 'peaks',
    left: 0.5,
    right: 0.25,
    holdLeft: 0.5,
    holdRight: 0.25,
    overload: false,
  };
  receive({ data: peaks } as MessageEvent<PeakReport>);
  expect(meter.read()).toEqual(peaks);
  const sink = node.outbound[0]!.to as FakeGain;
  expect(sink.gain.value).toBe(0);
  expect(sink.outbound[0]!.to).toBe(context.destination);
  meter.reset();
  expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'reset' });
  meter.setActive(false);
  expect(source.outbound.map((c) => c.to)).toEqual([context.destination]);
  expect(node.port.close).toHaveBeenCalledOnce();
  expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'stop' });
  expect(node.outbound).toEqual([]);
  expect(sink.outbound).toEqual([]);
  receive({ data: peaks } as MessageEvent<PeakReport>);
  expect(meter.read().left).toBe(0);
  meter.setActive(true);
  expect(nodes).toHaveLength(2);
  meter.dispose();
  meter.dispose();
  meter.setActive(true);
  expect(nodes).toHaveLength(2);
  expect(source.outbound.map((c) => c.to)).toEqual([context.destination]);
});
