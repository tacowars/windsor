/** The part meter bank (windsor#540): one node with an input per music part,
 * each metered with the strip meter's ballistics (`ChannelPeak`, two per
 * part), and one packed `Float32Array` of every part's report posted at the
 * strip meter's rate (`PEAK_METER.reportHz`). Started from the windsor#533
 * research prototype (`docs/research/2026-10-03-always-on-part-meters/`),
 * which measured it at 0.54–0.67 of the cost of one strip meter per part.
 *
 * An input with no channels (nothing connected, or an inactive source) and
 * nothing held is skipped: scanning its silence would change only the hold
 * countdowns of a channel holding zero, which any later sample restarts.
 * Every buffer is built in the constructor; `process` allocates nothing but
 * the platform's own clone of the posted report. The main thread's side is
 * `mixer/partMeterBank.ts`; `mixer/partMeterBankProcessor.test.ts` runs the
 * generated processor and `mixer/partMeterBankAllocation.test.ts` reads its
 * heap on V8.
 */
import { PEAK_METER } from '../../mixer/peakMeterConstants';
import type { PartMeterBankMessage } from '../../mixer/partMeterBankConstants';
import {
  PART_METER_BANK_NAME,
  PART_METER_FIELD,
  PART_METER_FIELDS,
  partMeterAckIndex,
} from '../../mixer/partMeterBankConstants';
import { ChannelPeak } from './channelPeak';
class PartMeterBankProcessor extends AudioWorkletProcessor {
  running: boolean;
  parts: number;
  frames: number;
  reportFrames: number;
  /** Part `k`'s left side at `2k`, its right at `2k + 1`. */
  channels: ChannelPeak[];
  /** What `post` sends: each part's five fields, then the ack (`partMeterAckIndex`). */
  report: Float32Array;
  ackIndex: number;
  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.running = true;
    this.parts = options.numberOfInputs ?? 1;
    this.frames = 0;
    this.reportFrames = NaN;
    this.reportFrames = sampleRate / PEAK_METER.reportHz;
    this.channels = [];
    for (let i = 0; i < this.parts * 2; i++) {
      this.channels.push(new ChannelPeak(sampleRate * PEAK_METER.holdSeconds));
    }
    this.report = new Float32Array(partMeterAckIndex(this.parts) + 1);
    this.ackIndex = partMeterAckIndex(this.parts);
    this.port.onmessage = ({ data }: MessageEvent<PartMeterBankMessage>) => {
      if (data.type === 'stop') {
        this.running = false;
        return;
      }
      const left = this.channels[data.slot * 2];
      const right = this.channels[data.slot * 2 + 1];
      if (left === undefined || right === undefined) return;
      if (data.type === 'reset') {
        left.resetLatch();
        right.resetLatch();
      } else {
        left.clear();
        right.clear();
      }
      this.report[this.ackIndex] = data.seq;
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.running) return false;
    const count = outputs[0]?.[0]?.length ?? 0;
    const channels = this.channels;
    for (let k = 0; k < this.parts; k++) {
      const input = inputs[k];
      const left = channels[k * 2];
      const right = channels[k * 2 + 1];
      const empty = input === undefined || input.length === 0;
      if (empty && left.hold === 0 && right.hold === 0) continue;
      const l = empty ? undefined : input[0];
      left.scan(l, count);
      right.scan(empty ? undefined : (input[1] ?? l), count);
    }
    // The output is the platform's zero-filled buffer: this tap is never audible.
    this.frames += count;
    if (this.frames >= this.reportFrames) this.post();
    return true;
  }
  /** Every part's report into `report`, posted; then each running peak starts over. */
  post(): void {
    const p = this.report;
    const channels = this.channels;
    for (let k = 0; k < this.parts; k++) {
      const left = channels[k * 2];
      const right = channels[k * 2 + 1];
      const o = k * PART_METER_FIELDS;
      p[o + PART_METER_FIELD.left] = left.peak;
      p[o + PART_METER_FIELD.right] = right.peak;
      p[o + PART_METER_FIELD.holdLeft] = left.hold;
      p[o + PART_METER_FIELD.holdRight] = right.hold;
      p[o + PART_METER_FIELD.overload] = left.overload || right.overload ? 1 : 0;
      left.peak = right.peak = 0;
    }
    this.port.postMessage(p);
    this.frames = 0;
  }
}
registerProcessor(PART_METER_BANK_NAME, PartMeterBankProcessor);
