/** Original Windsor research: the phase-3 resampler with a decimation loop that uses
 * the taps' even symmetry (windsor#207). One multiply per mirrored pair, the centre
 * tap alone; the interpolator is the phase-3 loop, copied unchanged. Summation order
 * differs from the existing loop, so bit identity is not claimed. No allocation in tick.
 */
import { ResampledHysteresis } from '../2026-09-30-tape-phase-3/resampler';
import { RESAMPLER as R, filterId, type Filter, type Resampler } from './resamplerConstants';

export class SymmetricResampledHysteresis extends ResampledHysteresis {
  /** The centre tap, held separately so a test can falsify the equivalence. */
  centre: number;
  constructor(options: ConstructorParameters<typeof ResampledHysteresis>[0]) {
    super(options);
    this.centre = this.taps[(this.taps.length - 1) / 2];
  }
  tick(x: number): number {
    const { factor, identity } = this.options;
    if (factor === 1) return identity ? x : this.core.tick(x);
    const { taps, input, output } = this,
      half = (taps.length - 1) / 2,
      last = output.length - 1;
    input[this.inputCursor] = x;
    let result = 0;
    for (let phase = 0; phase < factor; phase++) {
      let up = 0,
        read = this.inputCursor;
      for (let tap = phase; tap < taps.length; tap += factor) {
        up += taps[tap] * input[read];
        if (--read < 0) read = input.length - 1;
      }
      up *= factor;
      output[this.outputCursor] = identity ? up : this.core.tick(up);
      if (phase === 0) {
        // The ring holds exactly taps.length samples: newest at the cursor, oldest after it.
        let newest = this.outputCursor,
          oldest = newest === last ? 0 : newest + 1;
        for (let tap = 0; tap < half; tap++) {
          result += taps[tap] * (output[newest] + output[oldest]);
          if (--newest < 0) newest = last;
          if (++oldest > last) oldest = 0;
        }
        result += this.centre * output[newest];
      }
      if (++this.outputCursor === output.length) this.outputCursor = 0;
    }
    if (++this.inputCursor === input.length) this.inputCursor = 0;
    return result;
  }
}

/** Part 2's deterministic stereo signal: phase-3's benchmark sines left, LCG noise right. */
export function stereoSignal(table: Resampler = R): [Float64Array, Float64Array] {
  const { frames, noise, seed } = table.equivalence;
  const left = Float64Array.from({ length: frames }, (_, i) =>
    table.benchmark.input.reduce(
      (sum, [amplitude, radians]) => sum + amplitude * Math.sin(i * radians),
      0,
    ),
  );
  let state = seed >>> 0;
  const right = Float64Array.from({ length: frames }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return noise * (state / 2 ** 31 - 1);
  });
  return [left, right];
}

/** Error-free transformations (Knuth TwoSum, Dekker/Veltkamp TwoProduct). */
const SPLIT = 134217729;
function twoProduct(a: number, b: number): [number, number] {
  const p = a * b,
    [ah, al] = [a * SPLIT - (a * SPLIT - a), a - (a * SPLIT - (a * SPLIT - a))],
    [bh, bl] = [b * SPLIT - (b * SPLIT - b), b - (b * SPLIT - (b * SPLIT - b))];
  return [p, al * bl - (p - ah * bh - al * bh - ah * bl)];
}
/** Ogita-Rump-Oishi Dot2 of taps · x[end − k]: as if in twice the working precision. */
export function dot2(taps: ArrayLike<number>, x: ArrayLike<number>, end: number): number {
  let s = 0,
    c = 0;
  for (let k = 0; k < taps.length && end - k >= 0; k++) {
    const [p, e] = twoProduct(taps[k], x[end - k]),
      t = s + p,
      z = t - s;
    c += s - (t - z) + (p - z) + e;
    s = t;
  }
  return s + c;
}

/** Existing versus symmetric decimator, identity core, every stereo frame compared;
 * each loop's own error against a Dot2 reference over the same oversampled input. */
export function compareDecimators(
  f: Filter,
  table: Resampler = R,
  mutate: (dsp: SymmetricResampledHysteresis) => void = () => {},
) {
  const channels = stereoSignal(table),
    options = { rate: table.rate, ...f, identity: true };
  const peak = Math.max(...channels.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  const worst = { difference: 0, existingError: 0, symmetricError: 0 };
  let location = { channel: 0, frame: 0 },
    identicalFrames = 0;
  channels.forEach((signal, channel) => {
    const existing = new ResampledHysteresis(options),
      symmetric = new SymmetricResampledHysteresis(options),
      up = new Float64Array(signal.length * f.factor);
    mutate(symmetric);
    signal.forEach((x, frame) => {
      const start = existing.outputCursor,
        [a, b] = [existing.tick(x), symmetric.tick(x)];
      for (let p = 0; p < f.factor; p++)
        up[frame * f.factor + p] = existing.output[(start + p) % existing.output.length];
      const reference = dot2(existing.taps, up, frame * f.factor);
      worst.existingError = Math.max(worst.existingError, Math.abs(a - reference));
      worst.symmetricError = Math.max(worst.symmetricError, Math.abs(b - reference));
      if (a === b) identicalFrames++;
      if (Math.abs(a - b) > worst.difference)
        [worst.difference, location] = [Math.abs(a - b), { channel, frame }];
    });
  });
  const bound = table.equivalence.relativeBound * peak;
  return {
    id: filterId(f),
    ...f,
    peak,
    bound,
    maxDifference: worst.difference,
    relative: worst.difference / peak,
    location,
    existingError: worst.existingError,
    symmetricError: worst.symmetricError,
    identicalFrames,
    frames: 2 * table.equivalence.frames,
    passes: worst.difference <= bound,
  };
}
