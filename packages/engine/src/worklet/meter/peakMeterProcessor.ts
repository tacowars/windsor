/** Stereo sample peaks over every render quantum, on an opt-in silent tap (#666).
 * Each side's ballistics are a `ChannelPeak` (windsor#540, shared with the
 * part meter bank), and one reused report; no render-loop allocation. The
 * real generated processor is exercised by peakMeterProcessor.test.ts.
 */
import { PEAK_METER_NAME, PEAK_METER } from '../../mixer/peakMeterConstants';
import type { PeakReport } from '../../mixer/peakMeterConstants';
import { ChannelPeak } from './channelPeak';
class PeakMeterProcessor extends AudioWorkletProcessor {
  running: boolean;
  frames: number;
  left: ChannelPeak;
  right: ChannelPeak;
  report: PeakReport;
  constructor() {
    super();
    this.running = true;
    this.frames = 0;
    this.left = new ChannelPeak(sampleRate * PEAK_METER.holdSeconds);
    this.right = new ChannelPeak(sampleRate * PEAK_METER.holdSeconds);
    this.report = { type: 'peaks', left: 0, right: 0, holdLeft: 0, holdRight: 0, overload: false };
    this.port.onmessage = ({ data }: MessageEvent<{ type: 'stop' | 'reset' }>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reset') {
        this.left.resetLatch();
        this.right.resetLatch();
      }
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.running) return false;
    const count = outputs[0]?.[0]?.length ?? 0;
    const l = inputs[0]?.[0];
    const r = inputs[0]?.[1] ?? l;
    const left = this.left;
    const right = this.right;
    left.scan(l, count);
    right.scan(r, count);
    // Outputs are the platform's zero-filled buffers: this tap is never audible.
    this.frames += count;
    if (this.frames >= sampleRate / PEAK_METER.reportHz) {
      const p = this.report;
      p.left = left.peak;
      p.right = right.peak;
      p.holdLeft = left.hold;
      p.holdRight = right.hold;
      p.overload = left.overload || right.overload;
      this.port.postMessage(p);
      this.frames = 0;
      left.peak = right.peak = 0;
    }
    return true;
  }
}
registerProcessor(PEAK_METER_NAME, PeakMeterProcessor);
