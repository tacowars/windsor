/** Original Windsor research FIR, independent of JUCE/chowdsp.
 * Polyphase interpolation and output-rate decimation, constructor-only storage.
 * Identity core measures the filter pair alone. Tests pin gain and latency.
 */
import { EXPERIMENT as E } from './experimentConstants';
import { Hysteresis, type Solver } from './hysteresis';

export function coefficients(factor: number, span = E.firSpan): Float64Array {
  const taps = new Float64Array(span * factor + 1);
  const center = (taps.length - 1) / 2;
  const cutoff = E.cutoff / factor;
  let sum = 0;
  for (let i = 0; i < taps.length; i++) {
    const t = i - center;
    const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
    const window =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * i) / (taps.length - 1)) +
      0.08 * Math.cos((4 * Math.PI * i) / (taps.length - 1));
    taps[i] = sinc * window;
    sum += taps[i];
  }
  for (let i = 0; i < taps.length; i++) taps[i] /= sum;
  return taps;
}

export class ResampledHysteresis {
  readonly core: Hysteresis;
  readonly taps: Float64Array;
  readonly input: Float64Array;
  readonly output: Float64Array;
  readonly latency: number;
  inputCursor = 0;
  outputCursor = 0;
  constructor(
    readonly options: {
      rate: number;
      factor: number;
      solver?: Solver;
      identity?: boolean;
      span?: number;
    },
  ) {
    const { rate, factor, solver = 'rk4', span = E.firSpan } = options;
    if (
      ![1, 2, 4, 8, 16, 32, 64].includes(factor) ||
      !Number.isInteger(span) ||
      span < 2 ||
      span % 2
    )
      throw Error('Invalid resampler configuration');
    this.core = new Hysteresis(rate * factor, solver);
    this.taps = coefficients(factor, span);
    this.input = new Float64Array(span + 1);
    this.output = new Float64Array(this.taps.length);
    this.latency = factor === 1 ? 0 : span;
  }
  tick(x: number): number {
    const { factor, identity } = this.options;
    if (factor === 1) return identity ? x : this.core.tick(x);
    this.input[this.inputCursor] = x;
    let result = 0;
    for (let phase = 0; phase < factor; phase++) {
      let up = 0,
        read = this.inputCursor;
      for (let tap = phase; tap < this.taps.length; tap += factor) {
        up += this.taps[tap] * this.input[read];
        if (--read < 0) read = this.input.length - 1;
      }
      up *= factor;
      this.output[this.outputCursor] = identity ? up : this.core.tick(up);
      // Select phase zero: two symmetric FIRs delay by span host samples.
      if (phase === 0) {
        read = this.outputCursor;
        for (let tap = 0; tap < this.taps.length; tap++) {
          result += this.taps[tap] * this.output[read];
          if (--read < 0) read = this.output.length - 1;
        }
      }
      if (++this.outputCursor === this.output.length) this.outputCursor = 0;
    }
    if (++this.inputCursor === this.input.length) this.inputCursor = 0;
    return result;
  }
}
