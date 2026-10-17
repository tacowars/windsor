/**
 * The Dub delay's loop saturation and its level governor (record
 * `2026-10-17-dub-delay-regeneration`), one per line, after the loop filter.
 *
 * The shapes, each scaled by Drive going in and divided by it coming out, so
 * a quiet signal passes at unity whatever the Drive:
 *
 * - warm: the algebraic sigmoid z / √(1 + z²), leaned by `warmBias` so it
 *   bends one half of the wave sooner than the other (even harmonics, as a
 *   tired tape or a bucket-brigade line does), the lean's offset taken back
 *   out and its slope at rest scaled to one;
 * - fold: a triangle fold, which turns a peak past ±1 back on itself, its
 *   corners then rounded by the same sigmoid (`foldSoftness`).
 *
 * The governor: a mean-square follower before the shape and one after, and a
 * gain that brings the output's RMS to the input's, or to `ceiling` if the
 * input is louder. So Drive adds harmonics, not level, and a loop driven past
 * unity (a resonant filter, or sustain) settles at the ceiling as a steady
 * self-oscillation that every pass keeps colouring. It always runs, Drive 0
 * included, so no setting lets the loop grow without bound. Its output's
 * RMS never exceeds its input's: it adds no loop gain on average, which is
 * what `DelayDsp`'s sleep relies on.
 *
 * A character change crossfades the old shape's output to the new one's
 * (`fade`). `run` reads and writes `value`, its Drive is `drive`, and the
 * followers are plain fields per line, so no double crosses a call; only
 * `Math.sqrt` among `Math`'s functions, which is correctly rounded everywhere.
 * Pinned by inserts/delayDsp.test.ts and inserts/delayGolden.test.ts.
 */
import { DELAY_DSP as C, DELAY_GOVERNOR as G } from '../../inserts/delayConstants';
import { exp2 } from '../../inserts/tapePortableMath';

/** The triangle fold's period, and its offset, in the fold's own units. */
const FOLD_PERIOD = 4;
const FOLD_OFFSET = 1;
/** The rest slope of z / √(1 + z²) at the warm lean, √(1 + b²)³, and its value there. */
const WARM_REST = Math.sqrt(1 + C.warmBias * C.warmBias);
const WARM_SLOPE = WARM_REST * WARM_REST * WARM_REST;
const WARM_OFFSET = C.warmBias / WARM_REST;

class DelaySaturation {
  /** Each line's followers and its gain. */
  readonly squareIn: Float64Array;
  readonly squareOut: Float64Array;
  readonly gain: Float64Array;
  readonly detect: number;
  readonly settle: number;
  readonly ceilingSquare: number;
  /** `run`'s Drive, linear, and its crossfade from the old shape to the new. */
  drive: number;
  fade: number;
  /** The sample `run` shapes, and its result. */
  value: number;

  constructor(rate: number) {
    this.detect = this.settle = this.ceilingSquare = this.drive = this.fade = this.value = NaN;
    this.squareIn = new Float64Array(2);
    this.squareOut = new Float64Array(2);
    this.gain = new Float64Array(2);
    // e^(−1 / (rate · seconds)) through the portable 2^x, so the bits match on every platform.
    this.detect = 1 - exp2(-Math.LOG2E / (rate * G.detectSeconds));
    this.settle = 1 - exp2(-Math.LOG2E / (rate * G.gainSeconds));
    this.ceilingSquare = G.ceiling * G.ceiling;
    this.drive = 1;
    this.fade = 1;
    this.value = 0;
    this.clear();
  }

  /** `value` through line `line`'s shape, crossfaded by `fade` from `from` to `to`, then governed. */
  run(line: number, from: number, to: number): void {
    const x = this.value;
    const drive = this.drive;
    const z = x * drive;
    // warm
    const lean = z + C.warmBias;
    const warm = ((lean / Math.sqrt(1 + lean * lean) - WARM_OFFSET) * WARM_SLOPE) / drive;
    // fold: a triangle wave of z, period 4, through 0 at 0, then its corners rounded
    let t = z + FOLD_OFFSET;
    t -= FOLD_PERIOD * Math.floor(t / FOLD_PERIOD);
    const tri = (1 - Math.abs(t - 2)) * C.foldSoftness;
    const fold = tri / Math.sqrt(1 + tri * tri) / (C.foldSoftness * drive);
    const fromValue = from === 0 ? warm : fold;
    const y = fromValue + this.fade * ((to === 0 ? warm : fold) - fromValue);
    const square = (this.squareIn[line] += this.detect * (x * x - this.squareIn[line]));
    const shaped = (this.squareOut[line] += this.detect * (y * y - this.squareOut[line]));
    let target = 1;
    if (shaped > G.quietSquare)
      target = Math.min(
        G.maxGain * drive,
        Math.sqrt(Math.min(square, this.ceilingSquare) / shaped),
      );
    const gain = (this.gain[line] += this.settle * (target - this.gain[line]));
    this.value = y * gain;
  }

  /** Both lines' followers at rest and their gains at unity. */
  clear(): void {
    this.squareIn.fill(0);
    this.squareOut.fill(0);
    this.gain.fill(1);
  }
}

export { DelaySaturation };
