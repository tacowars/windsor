/** Stereo sample peaks over every render quantum, on an opt-in silent tap (#666).
 * Scalar state and one reused report; no render-loop allocation. The real
 * generated processor is exercised by peakMeterProcessor.test.ts.
 */
import { PEAK_METER_NAME, PEAK_METER } from '../../mixer/peakMeterConstants';
import type { PeakReport } from '../../mixer/peakMeterConstants';
class PeakMeterProcessor extends AudioWorkletProcessor {
  running: boolean;
  frames: number;
  holdL: number;
  holdR: number;
  report: PeakReport;
  constructor() {
    super();
    this.running = true;
    this.frames = this.holdL = this.holdR = 0;
    this.report = { type: 'peaks', left: 0, right: 0, holdLeft: 0, holdRight: 0, overload: false };
    this.port.onmessage = ({ data }: MessageEvent<{ type: 'stop' | 'reset' }>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reset') {
        this.report.overload = false;
        this.report.holdLeft = this.report.holdRight = 0;
        this.holdL = this.holdR = 0;
      }
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.running) return false;
    const count = outputs[0]?.[0]?.length ?? 0;
    const l = inputs[0]?.[0];
    const r = inputs[0]?.[1] ?? l;
    const p = this.report;
    for (let i = 0; i < count; i++) {
      const left = Math.abs(l?.[i] ?? 0);
      const right = Math.abs(r?.[i] ?? 0);
      p.left = Math.max(p.left, left);
      p.right = Math.max(p.right, right);
      if (--this.holdL <= 0 || left >= p.holdLeft) {
        p.holdLeft = left;
        this.holdL = sampleRate * PEAK_METER.holdSeconds;
      }
      if (--this.holdR <= 0 || right >= p.holdRight) {
        p.holdRight = right;
        this.holdR = sampleRate * PEAK_METER.holdSeconds;
      }
      if (left >= PEAK_METER.overload || right >= PEAK_METER.overload) p.overload = true;
    }
    // Outputs are the platform's zero-filled buffers: this tap is never audible.
    this.frames += count;
    if (this.frames >= sampleRate / PEAK_METER.reportHz) {
      this.port.postMessage(p);
      this.frames = 0;
      p.left = p.right = 0;
    }
    return true;
  }
}
registerProcessor(PEAK_METER_NAME, PeakMeterProcessor);
