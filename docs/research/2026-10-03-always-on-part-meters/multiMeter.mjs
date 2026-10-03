/** windsor#533 decision 4, research only: the main-thread side of the multi-input meter,
 * shaped like the shipped `createPeakMeter` (`packages/engine/src/mixer/peakMeter.ts`): a
 * silent tap into a zero-gain sink, and a message handler that keeps the latest report
 * and counts it. `sources[k]` feeds input k; the node has an input for every part.
 */
/* global AudioWorkletNode */
import { MULTI_METER } from './benchConstants.mjs';

export function createMultiMeter(context, sources, parts) {
  const node = new AudioWorkletNode(context, MULTI_METER.name, {
    numberOfInputs: parts,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
  });
  let revision = 0;
  let latest = new Float32Array(parts * MULTI_METER.fields);
  node.port.onmessage = ({ data }) => {
    latest = data;
    revision++;
  };
  const sink = context.createGain();
  sink.gain.value = 0;
  sources.forEach((source, k) => source.connect(node, 0, k));
  node.connect(sink);
  sink.connect(context.destination);
  return {
    get revision() {
      return revision;
    },
    /** Part k's report: left, right, holdLeft, holdRight, overload. */
    read: (k) => latest.subarray(k * MULTI_METER.fields, (k + 1) * MULTI_METER.fields),
    dispose() {
      sources.forEach((source, k) => source.disconnect(node, 0, k));
      node.port.postMessage({ type: 'stop' });
      node.port.onmessage = null;
      node.disconnect();
      sink.disconnect();
    },
  };
}
