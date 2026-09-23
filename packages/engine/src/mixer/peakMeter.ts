/** A view-owned meter tap, never in the audible path. Hidden views release it (#666). */
import { PEAK_METER_NAME } from './peakMeterConstants';
import type { PeakReport } from './peakMeterConstants';
export interface PeakMeter {
  readonly revision: number;
  read(): Readonly<PeakReport>;
  setActive(active: boolean): void;
  reset(): void;
  dispose(): void;
}
// eslint-disable-next-line max-lines-per-function -- 65 lines: one lazy meter tap and its creation, reset and disposal closure
export function createPeakMeter(context: BaseAudioContext, source: AudioNode): PeakMeter {
  let node: AudioWorkletNode | null = null;
  let sink: GainNode | null = null;
  let disposed = false;
  let revision = 0;
  let peaks: PeakReport = {
    type: 'peaks',
    left: 0,
    right: 0,
    holdLeft: 0,
    holdRight: 0,
    overload: false,
  };
  const stop = (): void => {
    if (!node) return;
    source.disconnect(node);
    node.port.postMessage({ type: 'stop' });
    node.port.onmessage = null;
    node.port.close();
    node.disconnect();
    sink!.disconnect();
    node = null;
    sink = null;
    peaks = { type: 'peaks', left: 0, right: 0, holdLeft: 0, holdRight: 0, overload: false };
    revision++;
  };
  return {
    get revision(): number {
      return revision;
    },
    read: () => peaks,
    setActive(active): void {
      if (!active) {
        stop();
        return;
      }
      if (node || disposed) return;
      node = new AudioWorkletNode(context, PEAK_METER_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
      });
      const current = node;
      node.port.onmessage = ({ data }: MessageEvent<PeakReport>): void => {
        if (node !== current || data.type !== 'peaks') return;
        peaks = data;
        revision++;
      };
      // A connected, silent sink keeps the meter rendering without summing
      // another copy of the program into the output. Its processor writes zero.
      sink = context.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(context.destination);
    },
    reset(): void {
      node?.port.postMessage({ type: 'reset' });
    },
    dispose(): void {
      disposed = true;
      stop();
    },
  };
}
