/**
 * The magnetic Tape core's oversampler (windsor#219, epic #146 milestone
 * E1): a polyphase interpolator that reconstructs the source field H and its
 * time derivative dH at every RK4 stage time of every oversampled step, the
 * field guard and knee on each stage point, the core, and a symmetric-tap
 * decimator back to the host rate. Unwired: E2 builds two per channel (2× and
 * 4×) inside `TapeDsp`.
 *
 * The kernel is Windsor's own, from its records
 * (`docs/log/2026-09-30-tape-resampler.md`,
 * `2026-09-30-tape-filtered-reference.md`): a Blackman-windowed sinc over
 * `span` host samples with cutoff 0.45 fs, the family #207 qualified at span
 * 48. H at stage time τ is Σ x[i] g(τ − i); dH is Σ x[i] g′(τ − i) times the
 * host rate, the kernel's own derivative, so H and dH are an exact
 * derivative pair rather than a finite difference. The stage times are a
 * phase set at twice the factor (each step's midpoint and end; its start is
 * the previous end). The decimator's taps are the same kernel at the
 * oversampled rate, `span × factor + 1` of them, exactly symmetric and
 * normalised to sum to 1, and the interpolator's integer phases are exactly
 * `factor` times them: the pair is one FIR used twice. Its fixed delay is
 * exactly `span` host samples (`latency`). The window and the sinc take
 * `sine` and `cosine` from `inserts/tapePortableMath.ts`, not `Math`, so the
 * taps are the same bits on every platform.
 *
 * Invariants: everything is allocated in the constructor; the per-sample
 * path (`advance`) allocates nothing and passes no double across a call
 * (input and output travel in fields, stage points in `stages`). Pinned by
 * `inserts/tapeOversample.test.ts` (coefficients, delay, #207's figures, the
 * derivative pair, the decimator, allocation) and
 * `inserts/tapeMagneticGolden.test.ts`.
 */
import { TAPE_MAGNETIC, type TapeMagneticControls } from '../../inserts/tapeMagneticConstants';
import { cosine, sine } from '../../inserts/tapePortableMath';
import { TapeMagneticCore, condition, guardField, type MagneticTable } from './tapeMagnetic';

/** The Blackman window over [−span/2, span/2] at |t|, and its slope there. */
function blackman(t: number, table: MagneticTable, slope: boolean): number {
  const [a0, a1, a2] = table.blackman as [number, number, number];
  const w = (2 * Math.PI) / table.span;
  if (slope) return -w * (a1 * sine(w * t) + 2 * a2 * sine(2 * w * t));
  return a0 + a1 * cosine(w * t) + a2 * cosine(2 * w * t);
}

/** The ideal low-pass sin(πβt)/(πt), β = 2 × cutoff, at t ≥ 0, and its slope there. */
function sinc(t: number, table: MagneticTable, slope: boolean): number {
  const beta = 2 * table.cutoff;
  if (t === 0) return slope ? 0 : beta;
  const x = Math.PI * beta * t;
  if (slope) return (x * cosine(x) - sine(x)) / (Math.PI * t * t);
  return sine(x) / (Math.PI * t);
}

/**
 * The unnormalised kernel g(t), t in host samples, or its derivative g′(t).
 * Computed at |t| and mirrored, so g is exactly even and g′ exactly odd; zero
 * from the window's ends outward.
 */
function kernel(t: number, table: MagneticTable, slope = false): number {
  const at = Math.abs(t);
  if (at >= table.span / 2) return 0;
  if (!slope) return blackman(at, table, false) * sinc(at, table, false);
  const odd =
    blackman(at, table, true) * sinc(at, table, false) +
    blackman(at, table, false) * sinc(at, table, true);
  return t < 0 ? -odd : odd;
}

/** The pair's taps: the decimator, and the interpolator's field and slope rows per stage phase. */
interface OversampleTaps {
  decimator: Float64Array;
  fieldTaps: Float64Array;
  slopeTaps: Float64Array;
}

/**
 * Taps for `factor` at `rate`. The decimator is g at (j − order/2) / factor,
 * scaled to sum to 1. Phase q (1 … 2 × factor) of the interpolator is the
 * stage time q / (2 factor) host samples into the step's host interval; its
 * row holds g (and rate × g′) at that time less each of the `span` host
 * samples in the window, oldest first, with the same scale times `factor`.
 */
function oversampleTaps(rate: number, factor: number, table: MagneticTable): OversampleTaps {
  const span = table.span;
  const order = span * factor;
  const decimator = new Float64Array(order + 1);
  let sum = 0;
  for (let j = 0; j <= order; j++) {
    decimator[j] = kernel((j - order / 2) / factor, table);
    sum += decimator[j]!;
  }
  const scale = factor / sum;
  for (let j = 0; j <= order; j++) decimator[j] = (decimator[j]! * scale) / factor;
  const phases = table.stagesPerStep * factor;
  const fieldTaps = new Float64Array(phases * span);
  const slopeTaps = new Float64Array(phases * span);
  for (let q = 1; q <= phases; q++) {
    for (let n = 0; n < span; n++) {
      const t = span / 2 - 1 + q / phases - n;
      fieldTaps[(q - 1) * span + n] = kernel(t, table) * scale;
      slopeTaps[(q - 1) * span + n] = kernel(t, table, true) * scale * rate;
    }
  }
  return { decimator, fieldTaps, slopeTaps };
}

class TapeOversampler {
  readonly rate: number;
  readonly factor: number;
  readonly span: number;
  /** The pair's fixed delay in host samples: exactly `span`. */
  readonly latency: number;
  /** True when the core is bypassed (the tests' identity core): the output is the reconstructed field. */
  readonly identity: boolean;
  core: TapeMagneticCore;
  decimator: Float64Array;
  fieldTaps: Float64Array;
  slopeTaps: Float64Array;
  /** The host input, doubled so the last `span` samples are always contiguous. */
  history: Float64Array;
  position: number;
  /**
   * The stage points of the host sample just processed, `[h, dh]` pairs:
   * pair 0 is the first step's start (the last sample's end), pair q is phase
   * q, guarded and conditioned unless `identity`.
   */
  stages: Float64Array;
  /** The oversampled core output, doubled for the decimator's window. */
  outputs: Float64Array;
  write: number;
  /** Field-guard engagements (stage points clipped) since construction. */
  guards: number;
  input: number;
  output: number;
  table: MagneticTable;

  constructor(
    rate: number,
    factor: number,
    identity = false,
    table: MagneticTable = TAPE_MAGNETIC,
  ) {
    this.rate = rate;
    this.factor = factor;
    this.span = table.span;
    this.latency = table.span;
    this.identity = identity;
    this.core = new TapeMagneticCore(rate, factor, undefined, table);
    const taps = oversampleTaps(rate, factor, table);
    this.decimator = taps.decimator;
    this.fieldTaps = taps.fieldTaps;
    this.slopeTaps = taps.slopeTaps;
    this.history = new Float64Array(2 * table.span);
    this.position = 0;
    this.stages = new Float64Array(2 * (table.stagesPerStep * factor + 1));
    this.outputs = new Float64Array(2 * this.decimator.length);
    this.write = 0;
    this.guards = 0;
    this.input = NaN;
    this.output = NaN;
    this.table = table;
    this.reset();
  }

  /** New core controls at this rate and factor; off the per-sample path. */
  configure(controls: Readonly<TapeMagneticControls>): void {
    this.core.configure(this.rate, this.factor, controls);
  }

  /** Silence: empty filters, a demagnetised core, zero stage points. Counters are kept. */
  reset(): void {
    this.history.fill(0);
    this.stages.fill(0);
    this.outputs.fill(0);
    this.position = 0;
    this.write = 0;
    this.input = 0;
    this.output = 0;
    this.core.reset();
  }

  /** One host sample in, one out, `latency` samples later. */
  process(x: number): number {
    this.input = x;
    this.advance();
    return this.output;
  }

  /** `count` host samples from `input` to `output`, the block entry. */
  render(input: Float32Array | Float64Array, output: Float32Array | Float64Array, count: number) {
    for (let i = 0; i < count; i++) {
      this.input = input[i]!;
      this.advance();
      output[i] = this.output;
    }
  }

  /** The per-sample path: interpolate every stage point, run the core per step, decimate. */
  advance(): void {
    const span = this.span;
    const stages = this.stages;
    const history = this.history;
    const last = stages.length - 2;
    stages[0] = stages[last]!;
    stages[1] = stages[last + 1]!;
    for (let q = 1, row = 0; row < this.fieldTaps.length; q++, row += span) {
      let h = 0;
      let dh = 0;
      for (let n = 0; n < span; n++) {
        const x = history[this.position + n]!;
        h += x * this.fieldTaps[row + n]!;
        dh += x * this.slopeTaps[row + n]!;
      }
      stages[2 * q] = h;
      stages[2 * q + 1] = dh;
      if (this.identity) continue;
      this.guards += guardField(stages, 2 * q, this.table);
      condition(stages, 2 * q, this.table);
    }
    const stride = 2 * this.table.stagesPerStep;
    for (let at = 0; at < last; at += stride) {
      let out: number;
      if (this.identity) out = stages[at + stride]!;
      else {
        this.core.tick(stages, at);
        out = this.core.out;
      }
      const size = this.decimator.length;
      this.write = this.write + 1 === size ? 0 : this.write + 1;
      this.outputs[this.write] = out;
      this.outputs[this.write + size] = out;
    }
    history[this.position] = this.input;
    history[this.position + span] = this.input;
    this.position = this.position + 1 === span ? 0 : this.position + 1;
    this.decimate();
  }

  /** The decimator over the window ending at the newest output: mirrored taps pair up, the centre alone. */
  decimate(): void {
    const taps = this.decimator;
    const outputs = this.outputs;
    const newest = this.write + taps.length;
    const oldest = this.write + 1;
    const centre = (taps.length - 1) / 2;
    let y = taps[centre]! * outputs[newest - centre]!;
    for (let j = 0; j < centre; j++) y += taps[j]! * (outputs[newest - j]! + outputs[oldest + j]!);
    this.output = y;
  }
}

export { TapeOversampler, kernel, oversampleTaps };
export type { OversampleTaps };
