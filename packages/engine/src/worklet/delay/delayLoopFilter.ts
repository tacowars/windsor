/* eslint-disable no-magic-numbers -- DSP: the state-variable filter's own arithmetic (its integrators' factor of 2, π, the octave-to-Q relation); the tunables are delayConstants.ts */
/**
 * The Dub delay's loop filter (record `2026-10-17-dub-delay-regeneration`):
 * one zero-delay-feedback state-variable filter per line (the trapezoidal
 * integrator form from the published TPT literature), inside the feedback
 * loop, so every repeat passes it again. One state gives all four shapes,
 * and Resonance is each shape's gain at its cutoff:
 *
 * - lowpass and highpass: Q is that gain (at least `minimumQ`), so a boost
 *   is a resonant peak and a cut a soft knee;
 * - bandpass: a peak of that gain, Width octaves wide;
 * - peak: the input plus a bell of that gain, Width octaves wide.
 *
 * With Feedback near unity a boost lifts the loop past unity at the cutoff,
 * and the repeats grow into a tone there, which the saturation's governor
 * (`delaySaturation.ts`) holds at its ceiling.
 *
 * A shape change crossfades the old shape's output to the new one's, read
 * from the one state (`DelayControlState`'s `filterFrom`, `filterTo` and
 * `filterFade`). `tune` runs every `filterInterval` samples per line, with
 * the motion's sweep in its octaves; it reads its inputs from fields and its
 * maths are the portable powers and tangent, so no double crosses a call and
 * a golden render is the same bits on every platform. `run` reads and writes
 * `value`. Pinned by inserts/delayDsp.test.ts and inserts/delayGolden.test.ts.
 */
import { DELAY_DSP as C } from '../../inserts/delayConstants';
import { exp2InPlace } from '../fm/portablePowers';
import { tanInPlace } from '../fm/portableTangent';

/** log2(10) / 20: a dB value's power of two. */
const FILTER_DB_EXPONENT = (Math.LOG2E * Math.LN10) / 20;

class DelayLoopFilter {
  readonly rate: number;
  /** Each line's two integrators. */
  readonly ic1: Float64Array;
  readonly ic2: Float64Array;
  /** Each line's coefficients, as `tune` last set them. */
  readonly a1: Float64Array;
  readonly a2: Float64Array;
  readonly a3: Float64Array;
  readonly k: Float64Array;
  /** Each line's gain at the cutoff, linear. */
  readonly peak: Float64Array;
  /** The four shapes' outputs for the sample, by shape id. */
  readonly shapes: Float64Array;
  readonly scratch: Float64Array;
  /** `tune`'s inputs: the cutoff in octaves above 1 Hz, Resonance in dB, Width in octaves. */
  octaves: number;
  resonanceDb: number;
  widthOctaves: number;
  /** `run`'s crossfade from the old shape to the new, 0 to 1. */
  fade: number;
  /** The sample `run` filters, and its result. */
  value: number;

  constructor(rate: number) {
    this.rate = this.octaves = this.resonanceDb = this.widthOctaves = this.fade = this.value = NaN;
    this.rate = rate;
    this.ic1 = new Float64Array(2);
    this.ic2 = new Float64Array(2);
    this.a1 = new Float64Array(2);
    this.a2 = new Float64Array(2);
    this.a3 = new Float64Array(2);
    this.k = new Float64Array(2);
    this.peak = new Float64Array(2);
    this.shapes = new Float64Array(4);
    this.scratch = new Float64Array(1);
    this.octaves = this.resonanceDb = this.widthOctaves = this.value = 0;
    this.fade = 1;
  }

  /** Line `line`'s coefficients for `shape` from `octaves`, `resonanceDb` and `widthOctaves`. */
  tune(line: number, shape: number): void {
    const x = this.scratch;
    x[0] = this.octaves;
    exp2InPlace(x, 0);
    const cutoff = Math.max(20, Math.min(x[0], this.rate * C.cutoffRateRatio));
    x[0] = (Math.PI * cutoff) / this.rate;
    tanInPlace(x, 0);
    const g = x[0];
    x[0] = this.resonanceDb * FILTER_DB_EXPONENT;
    exp2InPlace(x, 0);
    const peak = x[0];
    let q = Math.max(C.minimumQ, peak);
    if (shape >= 2) {
      // An octave span's Q: √(2^w) / (2^w − 1).
      x[0] = this.widthOctaves;
      exp2InPlace(x, 0);
      q = Math.sqrt(x[0]) / (x[0] - 1);
    }
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    this.k[line] = k;
    this.peak[line] = peak;
    this.a1[line] = a1;
    this.a2[line] = g * a1;
    this.a3[line] = g * g * a1;
  }

  /** `value` through line `line`, crossfaded by `fade` from shape `from` to shape `to`. */
  run(line: number, from: number, to: number): void {
    const x = this.value;
    const ic1 = this.ic1[line];
    const ic2 = this.ic2[line];
    const a2 = this.a2[line];
    const v3 = x - ic2;
    const v1 = this.a1[line] * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + this.a3[line] * v3;
    this.ic1[line] = 2 * v1 - ic1;
    this.ic2[line] = 2 * v2 - ic2;
    const band = this.k[line] * v1;
    const s = this.shapes;
    s[0] = v2;
    s[1] = x - band - v2;
    s[2] = this.peak[line] * band;
    s[3] = x + (this.peak[line] - 1) * band;
    this.value = s[from] + this.fade * (s[to] - s[from]);
  }

  /** Both lines' filters at rest. */
  clear(): void {
    this.ic1.fill(0);
    this.ic2.fill(0);
  }
}

export { DelayLoopFilter };
