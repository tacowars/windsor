/**
 * Early reflections (RV-1): a Moorer-style tapped delay, a few discrete taps per channel read from
 * the pre-delayed signal and sent straight to the wet output, ahead of the tank's first return.
 * It owns no storage: it reads the finite field's history (`RetroReflections.delay`), which is
 * written with the pre-delayed sample every internal tick in every mode, so its taps read the
 * same signal the tank takes. `tick` must run before that tick's write, so a tap `n` samples
 * long reads the sample written `n` ticks ago.
 *
 * `configure` scales the times by Size, clamped to `earlyScaleMin`–`earlyScaleMax`, and fixes
 * each tap's whole offset and fraction. `tick` leaves its sums in `left`/`right`: fields, not
 * results, which V8 boxes across a call it does not inline (worklet rule 2). Every double field
 * is first written as one (rule 7). `inserts/retroReverbEarly.test.ts` pins what it adds, and
 * `retroReverbAllocation.test.ts` that it allocates nothing.
 */
import { RETRO_REVERB_DSP as C } from '../../inserts/retroReverbConstants';
import type { RetroDelay } from './retroDelay';

class RetroEarly {
  history: RetroDelay;
  offsetsLeft: Int32Array;
  offsetsRight: Int32Array;
  fractionsLeft: Float64Array;
  fractionsRight: Float64Array;
  left: number;
  right: number;
  /** The Size `configure` reads. */
  size: number;

  constructor(history: RetroDelay) {
    this.history = history;
    this.offsetsLeft = new Int32Array(C.earlySecondsLeft.length);
    this.offsetsRight = new Int32Array(C.earlySecondsRight.length);
    this.fractionsLeft = new Float64Array(C.earlySecondsLeft.length);
    this.fractionsRight = new Float64Array(C.earlySecondsRight.length);
    this.left = this.right = this.size = NaN;
    this.left = this.right = 0;
    this.size = 1;
  }

  configure(): void {
    const scale = Math.max(C.earlyScaleMin, Math.min(C.earlyScaleMax, this.size)) * C.rate;
    const longest = this.history.buffer.length - 2;
    for (let i = 0; i < C.earlySecondsLeft.length; i++) {
      const delay = Math.max(1, Math.min(longest, C.earlySecondsLeft[i] * scale));
      this.offsetsLeft[i] = Math.ceil(delay);
      this.fractionsLeft[i] = Math.ceil(delay) - delay;
    }
    for (let i = 0; i < C.earlySecondsRight.length; i++) {
      const delay = Math.max(1, Math.min(longest, C.earlySecondsRight[i] * scale));
      this.offsetsRight[i] = Math.ceil(delay);
      this.fractionsRight[i] = Math.ceil(delay) - delay;
    }
  }

  tick(): void {
    const buffer = this.history.buffer;
    const head = this.history.head;
    const length = buffer.length;
    let left = 0,
      right = 0;
    for (let i = 0; i < C.earlySecondsLeft.length; i++) {
      let index = head - this.offsetsLeft[i];
      if (index < 0) index += length;
      const next = index + 1 === length ? 0 : index + 1;
      left +=
        C.earlyGainsLeft[i] *
        (buffer[index] + this.fractionsLeft[i] * (buffer[next] - buffer[index]));
    }
    for (let i = 0; i < C.earlySecondsRight.length; i++) {
      let index = head - this.offsetsRight[i];
      if (index < 0) index += length;
      const next = index + 1 === length ? 0 : index + 1;
      right +=
        C.earlyGainsRight[i] *
        (buffer[index] + this.fractionsRight[i] * (buffer[next] - buffer[index]));
    }
    this.left = left * C.earlyTrim;
    this.right = right * C.earlyTrim;
  }
}

export { RetroEarly };
