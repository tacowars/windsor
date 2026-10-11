/**
 * bloom's decimator (`BLOOM_DSP`): the mono input brought down to the
 * analysis rate, host rate / `factor`, for the bands and the shared
 * detector. `factor` is the largest power of two that keeps the analysis
 * rate at or above `analysisHz`, so 4 at 44.1/48 kHz and 8 at 88.2/96 kHz.
 *
 * The filter is `decimatorOrder` cascaded boxcars of `factor` samples, one
 * symmetric FIR (sinc^order): its nulls sit on every multiple of the
 * analysis rate, the only places a band's 70–1409 Hz can alias from, so an
 * image there is at least 68 dB down (48 kHz, ÷4). It is computed only on
 * the samples kept. Its droop in the bands, under 0.7 dB at 1.32 kHz, is
 * made up in each band's input gain (`gainAt`); its delay is
 * order·(factor − 1)/2 host samples, 0.125 ms at 48 kHz.
 *
 * Per host sample `push` takes `input`; once `factor` samples are in,
 * `ready` is true and `output` is the analysis sample. No double crosses a
 * call; every double field is born NaN.
 */
import { BLOOM_DSP as C } from '../../inserts/bloomConstants';
import { sine } from '../../inserts/tapePortableMath';

class BloomDecimator {
  rate: number;
  factor: number;
  /** Half the symmetric taps (the centre last), and the doubled input ring. */
  taps: Float64Array;
  ring: Float64Array;
  length: number;
  at: number;
  /** Host samples pushed since the last analysis sample. */
  count: number;
  ready: boolean;
  input: number;
  output: number;

  constructor(rate: number) {
    this.rate = this.input = this.output = NaN;
    this.rate = rate;
    let factor = 1;
    while (rate / (2 * factor) >= C.analysisHz) factor *= 2;
    this.factor = factor;
    // The boxcars' convolution: order·(factor − 1) + 1 taps, summing to 1.
    let kernel = Float64Array.of(1);
    for (let n = 0; n < C.decimatorOrder; n++) {
      const next = new Float64Array(kernel.length + factor - 1);
      for (let i = 0; i < kernel.length; i++)
        for (let j = 0; j < factor; j++) next[i + j] += kernel[i] / factor;
      kernel = next;
    }
    this.length = kernel.length;
    const half = (this.length - 1) / 2;
    this.taps = kernel.slice(0, half + 1);
    this.ring = new Float64Array(2 * this.length);
    this.at = this.count = 0;
    this.ready = false;
    this.clear();
  }

  /** The analysis rate, host rate / factor. */
  get analysisRate(): number {
    return this.rate / this.factor;
  }

  /** The filter's gain at `hz` (real: its phase is a pure delay). Off the sample path. */
  gainAt(hz: number): number {
    const x = (Math.PI * hz) / this.rate;
    if (this.factor === 1 || x === 0) return 1;
    const one = sine(this.factor * x) / (this.factor * sine(x));
    let gain = 1;
    for (let n = 0; n < C.decimatorOrder; n++) gain *= one;
    return gain;
  }

  clear(): void {
    this.ring.fill(0);
    this.at = this.count = 0;
    this.ready = false;
    this.output = 0;
    this.input = 0;
  }

  /** One host sample in; on every `factor`-th, the filtered sample into `output`. */
  push(): void {
    const length = this.length;
    let at = this.at - 1;
    if (at < 0) at = length - 1;
    this.at = at;
    this.ring[at] = this.input;
    this.ring[at + length] = this.input;
    if (++this.count < this.factor) {
      this.ready = false;
      return;
    }
    this.count = 0;
    this.ready = true;
    const ring = this.ring,
      taps = this.taps,
      half = taps.length - 1;
    let sum = taps[half] * ring[at + half];
    for (let k = 0; k < half; k++) sum += taps[k] * (ring[at + k] + ring[at + length - 1 - k]);
    this.output = sum;
  }
}

export { BloomDecimator };
