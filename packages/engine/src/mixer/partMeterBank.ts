/**
 * The part meter bank (windsor#540): one `AudioWorkletNode` metering every
 * music part, with an input per slot (`MUSIC_PARTS_MAX`), where one strip
 * meter per part (`peakMeter.ts`) builds a node each. windsor#533 measured it
 * at 0.54–0.67 of their cost on the audio thread, with one message a report
 * for every part (`docs/research/2026-10-03-always-on-part-meters/`).
 *
 * Like the strip meter it is lazy and silent: no node until
 * `setActive(true)`, and then a tap behind a zero-gain sink, never in the
 * audible path. Slot `k` is input `k`, so a part keeps its input across any
 * reorder of the part list; `attach` and `detach` follow parts being added
 * and removed, and hold while inactive, so activation connects every
 * attached part. The processor is `worklet/meter/partMeterBankProcessor.ts`,
 * in the meter bundle the engine already loads (`PEAK_METER_WORKLET_URL`).
 *
 * Each slot's report is one object, rewritten in place as messages arrive:
 * `revision` says when, and a reader copies what it keeps. A slot reset or
 * detached here reads zero at once, and a report the processor posted before
 * it handled that is ignored for the slot (the message's ack), so a removed
 * part's clip latch never lands on the part that next takes its slot.
 * `partMeterBank.test.ts` pins the lifetime and the routing.
 */
import { MUSIC_PARTS_MAX } from '../audioConstants';
import type { PartMeterBankMessage } from './partMeterBankConstants';
import {
  PART_METER_BANK_NAME,
  PART_METER_FIELD,
  PART_METER_FIELDS,
  partMeterAckIndex,
} from './partMeterBankConstants';
import type { PeakReport } from './peakMeterConstants';

export interface PartMeterBank {
  /** Advances with each report, and when a slot is reset, detached or the bank stops. */
  readonly revision: number;
  /** Meter `source` on `slot`'s input, in place of whatever was there. */
  attach(slot: number, source: AudioNode): void;
  /** Stop metering `slot`; it reads zero until a part is attached again. */
  detach(slot: number): void;
  /** Build the node and connect every attached part, or tear it all down and read zero. */
  setActive(active: boolean): void;
  /** `slot`'s latest report, the same object for the bank's life. */
  read(slot: number): Readonly<PeakReport>;
  /** `slot`'s clip latch and held peaks back to zero, as the strip meter's `reset`. */
  reset(slot: number): void;
  /** Disconnect everything; the bank cannot start again. */
  dispose(): void;
}

const silent = (): PeakReport => ({
  type: 'peaks',
  left: 0,
  right: 0,
  holdLeft: 0,
  holdRight: 0,
  overload: false,
});

function zero(report: PeakReport): void {
  report.left = report.right = report.holdLeft = report.holdRight = 0;
  report.overload = false;
}

class Bank implements PartMeterBank {
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private disposed = false;
  private count = 0;
  /** The last `reset` or `clear` posted, and per slot the one a report must have seen. */
  private seq = 0;
  private readonly settled = new Array<number>(MUSIC_PARTS_MAX).fill(0);
  private readonly sources = new Array<AudioNode | null>(MUSIC_PARTS_MAX).fill(null);
  private readonly reports = Array.from({ length: MUSIC_PARTS_MAX }, silent);

  constructor(private readonly context: BaseAudioContext) {}

  get revision(): number {
    return this.count;
  }

  attach(slot: number, source: AudioNode): void {
    checkSlot(slot);
    if (this.disposed || this.sources[slot] === source) return;
    this.detach(slot);
    this.sources[slot] = source;
    if (this.node) source.connect(this.node, 0, slot);
  }

  detach(slot: number): void {
    checkSlot(slot);
    const source = this.sources[slot];
    if (!source) return;
    this.sources[slot] = null;
    if (this.node) source.disconnect(this.node, 0, slot);
    this.settle(slot, 'clear');
  }

  setActive(active: boolean): void {
    if (!active) {
      this.stop();
      return;
    }
    if (this.node || this.disposed) return;
    const node = new AudioWorkletNode(this.context, PART_METER_BANK_NAME, {
      numberOfInputs: MUSIC_PARTS_MAX,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    this.node = node;
    node.port.onmessage = ({ data }: MessageEvent<Float32Array>): void => {
      if (this.node === node) this.receive(data);
    };
    // A connected, silent sink keeps the node rendering without summing
    // another copy of the program into the output. Its processor writes zero.
    this.sink = this.context.createGain();
    this.sink.gain.value = 0;
    this.sources.forEach((source, slot) => source?.connect(node, 0, slot));
    node.connect(this.sink);
    this.sink.connect(this.context.destination);
  }

  read(slot: number): Readonly<PeakReport> {
    checkSlot(slot);
    return this.reports[slot]!;
  }

  reset(slot: number): void {
    checkSlot(slot);
    if (this.node) this.settle(slot, 'reset');
  }

  dispose(): void {
    this.stop();
    this.sources.fill(null);
    this.disposed = true;
  }

  /** Every attached part off the node, the node and its sink gone, every slot zero. */
  private stop(): void {
    const node = this.node;
    if (!node) return;
    this.sources.forEach((source, slot) => source?.disconnect(node, 0, slot));
    node.port.postMessage({ type: 'stop' } satisfies PartMeterBankMessage);
    node.port.onmessage = null;
    node.port.close();
    node.disconnect();
    this.sink!.disconnect();
    this.node = null;
    this.sink = null;
    this.reports.forEach(zero);
    // A new node starts with its ack at 0 and nothing to ignore.
    this.seq = 0;
    this.settled.fill(0);
    this.count++;
  }

  /** Zero `slot` here, and tell the processor; reports until it has handled that are stale for the slot. */
  private settle(slot: number, type: 'reset' | 'clear'): void {
    const report = this.reports[slot]!;
    if (type === 'clear') zero(report);
    else report.holdLeft = report.holdRight = 0;
    report.overload = false;
    this.count++;
    if (!this.node) return;
    this.seq++;
    this.settled[slot] = this.seq;
    this.node.port.postMessage({ type, slot, seq: this.seq } satisfies PartMeterBankMessage);
  }

  private receive(data: Float32Array): void {
    const ack = data[partMeterAckIndex(MUSIC_PARTS_MAX)] ?? 0;
    for (let slot = 0; slot < MUSIC_PARTS_MAX; slot++) {
      if (ack < this.settled[slot]!) continue;
      const o = slot * PART_METER_FIELDS;
      const report = this.reports[slot]!;
      report.left = data[o + PART_METER_FIELD.left]!;
      report.right = data[o + PART_METER_FIELD.right]!;
      report.holdLeft = data[o + PART_METER_FIELD.holdLeft]!;
      report.holdRight = data[o + PART_METER_FIELD.holdRight]!;
      report.overload = data[o + PART_METER_FIELD.overload] !== 0;
    }
    this.count++;
  }
}

function checkSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MUSIC_PARTS_MAX) {
    throw new RangeError(`part meter bank: no slot ${slot} (0 to ${MUSIC_PARTS_MAX - 1})`);
  }
}

/**
 * One bank for the song's music parts: lazy, so nothing is built until
 * `setActive(true)`. The context must have loaded the meter bundle
 * (`FmEngine.init` does).
 */
export function createPartMeterBank(context: BaseAudioContext): PartMeterBank {
  return new Bank(context);
}
