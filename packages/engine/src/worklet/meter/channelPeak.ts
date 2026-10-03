/** One channel's sample-peak ballistics (#666, windsor#540): the peak since
 * the last report, the held peak and its countdown, and the overload latch.
 * Shared by the strip meter (`peakMeterProcessor.ts`, two of them) and the
 * part meter bank (`partMeterBankProcessor.ts`, two per part), so a light
 * reads the same from either. The per-sample loop is the strip meter's as it
 * shipped, run on one channel: left and right never shared state but the
 * latch, which the processors OR. `mixer/peakMeterProcessor.test.ts` pins
 * the strip meter's reports and `mixer/partMeterBankProcessor.test.ts` the
 * bank's. No allocation; every double field is first written as NaN
 * (worklet rule 7), and `scan` takes the block and its length, no double.
 */
import { PEAK_METER } from '../../mixer/peakMeterConstants';
export class ChannelPeak {
  /** The largest magnitude since the processor last reported and zeroed it. */
  peak: number;
  /** The held peak: it falls to the current sample when `countdown` runs out. */
  hold: number;
  countdown: number;
  /** Latched at full scale (`PEAK_METER.overload`) until `resetLatch` or `clear`. */
  overload: boolean;
  /** Frames a held peak lasts: the scope's rate times `PEAK_METER.holdSeconds`. */
  holdFrames: number;
  constructor(holdFrames: number) {
    this.peak = this.hold = this.countdown = this.holdFrames = NaN;
    this.peak = this.hold = this.countdown = 0;
    this.holdFrames = holdFrames;
    this.overload = false;
  }
  /**
   * `count` frames of `samples` (a render quantum: the platform's channels
   * are that long); a missing channel reads as silence. Silence has its own
   * loop, where the peak cannot rise or the latch set: one loop reading
   * `samples?.[i] ?? 0` merged each sample with the integer 0, and V8 then
   * boxed every sample once a missing channel had been seen (16 bytes a
   * sample, windsor#540's allocation test).
   */
  scan(samples: Float32Array | undefined, count: number): void {
    let peak = this.peak;
    let hold = this.hold;
    let countdown = this.countdown;
    let overload = this.overload;
    const holdFrames = this.holdFrames;
    if (samples === undefined) {
      for (let i = 0; i < count; i++) {
        if (--countdown <= 0 || 0 >= hold) {
          hold = 0;
          countdown = holdFrames;
        }
      }
    } else {
      for (let i = 0; i < count; i++) {
        const x = Math.abs(samples[i]);
        peak = Math.max(peak, x);
        if (--countdown <= 0 || x >= hold) {
          hold = x;
          countdown = holdFrames;
        }
        if (x >= PEAK_METER.overload) overload = true;
      }
    }
    this.peak = peak;
    this.hold = hold;
    this.countdown = countdown;
    this.overload = overload;
  }
  /** The strip meter's `reset`: the latch and the held peak go, the running peak stays. */
  resetLatch(): void {
    this.overload = false;
    this.hold = this.countdown = 0;
  }
  /** Everything back to its start: the channel's source was detached. */
  clear(): void {
    this.resetLatch();
    this.peak = 0;
  }
}
