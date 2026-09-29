/**
 * The output stage's two clippers, soft and hard, at 2× oversampling
 * (windsor#93 decisions 5, 6 and 7).
 *
 * The signal is upsampled by a linear-phase half-band FIR, clipped at the
 * doubled rate, and decimated by the same filter. Only the clipper's
 * *residual* goes through the filters: the curve's output less its input,
 * which is exactly 0 wherever the curve is the identity. The residual is
 * decimated and added to the input, delayed by the filters' latency. So a
 * signal the curve never touches comes out as the input, bit for bit, and
 * only the distortion itself is band-limited. The sum is then clamped at the
 * ceiling, since the decimated residual can ring a little past it.
 *
 * The half-band's even-offset taps are zero but the centre, so each
 * upsampled pair is one short convolution (the even phase) and one delayed
 * sample (the odd phase), and the decimator is the same convolution over the
 * even residuals plus half the odd one. While the residual has been 0 for
 * longer than the filter, the decimator is skipped.
 *
 * Everything is allocated in the constructor; `process` allocates nothing.
 * `outputStageDsp.test.ts` pins the behaviour and `outputStageGolden.test.ts`
 * the render.
 */
import { OUTPUT_OVERSAMPLE } from './outputStageConstants';

/** One channel's histories, at the song's rate: the input, and the even and odd residuals. */
export interface ClipperChannel {
  readonly input: Float64Array;
  readonly even: Float64Array;
  readonly odd: Float64Array;
  pos: number;
  /** Frames since the last residual that was not 0. */
  quiet: number;
}

/** What one block did, for the telemetry. */
export interface ClipperActivity {
  acted: boolean;
}

/**
 * The half-band's non-zero even-phase taps, `h[2k]` for k = 0 … (taps − 1) / 2,
 * scaled to sum to exactly 1 so a constant passes each phase unchanged.
 */
export function halfBandTaps(table: typeof OUTPUT_OVERSAMPLE = OUTPUT_OVERSAMPLE): Float64Array {
  const n = table.taps;
  const centre = (n - 1) / 2;
  const [a0, a1, a2] = table.blackman;
  const taps = new Float64Array(centre + 1);
  let sum = 0;
  for (let k = 0; k <= centre; k++) {
    const j = 2 * k;
    const d = j - centre;
    // Over n + 1 points, so the end taps are not zero.
    const phase = (2 * Math.PI * (j + 1)) / (n + 1);
    const window = a0 - a1 * Math.cos(phase) + a2 * Math.cos(2 * phase);
    const sinc = Math.sin((Math.PI * d) / table.factor) / ((Math.PI * d) / table.factor);
    taps[k] = sinc * window;
    sum += taps[k]!;
  }
  for (let k = 0; k <= centre; k++) taps[k] = taps[k]! / sum;
  return taps;
}

export class OversampledClipper {
  /** Frames the output lags the input by: (taps − 1) / 2. */
  readonly latency: number = 0;
  private readonly taps: Float64Array;
  private readonly mask: number = 0;
  /** How far back the odd phase's sample sits, upsampling and decimating. */
  private readonly upOdd: number = 0;
  private readonly downOdd: number = 0;
  private soft = false;
  private ceiling = 1;
  private knee = 1;

  constructor(table: typeof OUTPUT_OVERSAMPLE = OUTPUT_OVERSAMPLE) {
    this.taps = halfBandTaps(table);
    this.latency = this.taps.length - 1;
    this.upOdd = (this.latency - 1) / 2;
    this.downOdd = (this.latency + 1) / 2;
    let size = 1;
    while (size < this.taps.length) size *= 2;
    this.mask = size - 1;
  }

  /** A channel's state, zeroed. Built once per channel, at construction. */
  channel(): ClipperChannel {
    const size = this.mask + 1;
    return {
      input: new Float64Array(size),
      even: new Float64Array(size),
      odd: new Float64Array(size),
      pos: 0,
      quiet: size,
    };
  }

  /** The curve and its levels, linear. Takes effect on the next frame. */
  configure(soft: boolean, ceiling: number, knee: number): void {
    this.soft = soft;
    this.ceiling = ceiling;
    this.knee = knee;
  }

  /** Silence in, silence out: the histories cleared. */
  reset(channel: ClipperChannel): void {
    channel.input.fill(0);
    channel.even.fill(0);
    channel.odd.fill(0);
    channel.pos = 0;
    channel.quiet = this.mask + 1;
  }

  process(
    channel: ClipperChannel,
    input: Float32Array,
    output: Float32Array,
    frames: number,
    activity: ClipperActivity,
  ): void {
    const { taps, mask, latency, ceiling } = this;
    const x = channel.input;
    const even = channel.even;
    const odd = channel.odd;
    let pos = channel.pos;
    let quiet = channel.quiet;
    for (let i = 0; i < frames; i++) {
      pos = (pos + 1) & mask;
      x[pos] = input[i]!;
      let up = 0;
      for (let k = 0; k <= latency; k++) up += taps[k]! * x[(pos - k) & mask]!;
      const re = this.residual(up);
      const ro = this.residual(x[(pos - this.upOdd) & mask]!);
      even[pos] = re;
      odd[pos] = ro;
      quiet = re !== 0 || ro !== 0 ? 0 : quiet + 1;
      const dry = x[(pos - latency) & mask]!;
      if (quiet > latency) {
        output[i] = dry;
        continue;
      }
      let down = 0;
      for (let k = 0; k <= latency; k++) down += taps[k]! * even[(pos - k) & mask]!;
      let y = dry + (down + odd[(pos - this.downOdd) & mask]!) / 2;
      if (y > ceiling) y = ceiling;
      else if (y < -ceiling) y = -ceiling;
      activity.acted = true;
      output[i] = y;
    }
    channel.pos = pos;
    channel.quiet = quiet;
  }

  /** The curve less the identity: 0 wherever the curve leaves the sample alone. */
  private residual(w: number): number {
    const a = w < 0 ? -w : w;
    const c = this.ceiling;
    if (!this.soft) {
      if (a <= c) return 0;
      return w > 0 ? c - w : -c - w;
    }
    const k = this.knee;
    if (a <= k) return 0;
    const u = (a - k) / (c - k);
    const y = k + ((c - k) * u) / (1 + u);
    return w > 0 ? y - w : -y - w;
  }
}
