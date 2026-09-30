/**
 * The magnetic Tape core (windsor#219, epic #146 milestone E1): a scalar
 * Jiles–Atherton magnetization integrated by classical RK4 at the
 * oversampled rate, with the field guard and the knee that condition its
 * input. Unwired: E2 connects it inside `TapeDsp`.
 *
 * Written for Windsor from the published model — Jiles and Atherton,
 * *Theory of ferromagnetic hysteresis*, J. Magn. Magn. Mater. 61 (1986), and
 * its use for tape in Chowdhury, *Real-time physical modelling for analog
 * tape machines*, DAFx 2019 — and from Windsor's own decision records
 * (`docs/log/2026-09-30-tape-magnetic-integration-design.md`,
 * `2026-09-30-tape-static-conditioning.md`). The implementation is Windsor's
 * own; it imports and copies nothing from `docs/research/` or any other
 * implementation. The equation, with Q = (H + αM)/a, Man = Ms L(Q) and
 * δ = sign(dH/dt), is
 *
 *   dM/dt = dH/dt · [ (1−c) δM (Man − M) / ((1−c) δ k − α (Man − M))
 *                     + c (Ms/a) L′(Q) ] / [ 1 − α c (Ms/a) L′(Q) ]
 *
 * where δM is 1 while the field drives M toward Man and 0 otherwise.
 *
 * Invariants: every buffer and field is written in the constructor and the
 * per-sample path allocates nothing and passes no double across a call (the
 * stage values travel in the oversampler's `Float64Array`, the result in a
 * field); `configure` recomputes every derived coefficient and the output
 * normalisation, and is never on that path. The step calls no
 * transcendental `Math` function: tanh is `tanhInPlace`'s, in IEEE
 * arithmetic, so the render is the same bits on arm64 and x64. Pinned by
 * `inserts/tapeMagnetic.test.ts` (the research ruler, the knee, both
 * guards, normalisation) and `inserts/tapeMagneticGolden.test.ts`.
 */
import {
  TAPE_MAGNETIC,
  TAPE_MAGNETIC_DEFAULT_CONTROLS,
  type TapeMagneticControls,
} from '../../inserts/tapeMagneticConstants';
import { tanhInPlace } from '../../inserts/tapePortableMath';

type MagneticTable = typeof TAPE_MAGNETIC;

/**
 * The field guard, in place on the stage point at `stages[at]` (its field)
 * and `stages[at + 1]` (its derivative): a field past ±`fieldGuard` is
 * clipped there, and a field that is not a number becomes zero; either way
 * the derivative of the clipped field is zero. Returns 1 when it engaged.
 */
function guardField(
  stages: Float64Array,
  at: number,
  table: MagneticTable = TAPE_MAGNETIC,
): number {
  const h = stages[at]!;
  const limit = table.fieldGuard;
  if (h >= -limit && h <= limit) return 0;
  stages[at] = h > limit ? limit : h < -limit ? -limit : 0;
  stages[at + 1] = 0;
  return 1;
}

/**
 * The odd C1 knee, in place on a stage point: the field is unchanged up to
 * |h| = knee; past it, with span = asymptote − knee and z = (|h| − knee) / span,
 * it becomes knee + span · z / (1 + z), which meets the identity with slope 1
 * and approaches the asymptote. The derivative takes the knee's slope
 * 1 / (1 + z)², the chain rule, so the pair stays a field and its derivative.
 */
function condition(stages: Float64Array, at: number, table: MagneticTable = TAPE_MAGNETIC): void {
  const h = stages[at]!;
  const magnitude = Math.abs(h);
  if (magnitude <= table.knee) return;
  const span = table.asymptote - table.knee;
  const z = (magnitude - table.knee) / span;
  const lift = 1 + z;
  const field = table.knee + span * (z / lift);
  stages[at] = h < 0 ? -field : field;
  stages[at + 1] = stages[at + 1]! * (1 / (lift * lift));
}

/**
 * The origin susceptibility of a control row: the small-signal slope dM/dH at
 * H = M = 0, where only the reversible term acts, c r / (1 − α c r) with
 * r = (Ms/a) L′(0). Zero at the width endpoint, where c clamps to zero.
 */
function originSusceptibility(
  controls: TapeMagneticControls,
  table: MagneticTable = TAPE_MAGNETIC,
): number {
  const ms = table.saturationFloor + table.saturationScale * (1 - controls.saturation);
  const a = ms / (table.driveFloor + table.driveScale * controls.drive);
  const c = Math.max(0, Math.sqrt(1 - controls.width) - table.reversibleOffset);
  const r = (ms / a) * table.langevinOriginSlope;
  return (c * r) / (1 - table.alpha * c * r);
}

class TapeMagneticCore {
  /** Magnetization, the state, at the end of the last step. */
  m: number;
  /** The last step's output: `m` normalised to unity small-signal gain. */
  out: number;
  /** State-guard engagements since construction. */
  resets: number;
  /** Derived by `configure`. */
  ms: number;
  invA: number;
  reversibleGain: number;
  irreversible: number;
  irreversibleK: number;
  dt: number;
  susceptibility: number;
  gain: number;
  /** Copied from the table once, so the step reads fields. */
  alpha: number;
  stateGuard: number;
  seriesLimit: number;
  series: Float64Array;
  slopeSeries: Float64Array;
  offsets: Int32Array;
  reach: Float64Array;
  weights: Float64Array;
  divisor: number;
  /** One double for `tanhInPlace`, so no double crosses that call. */
  scratch: Float64Array;
  table: MagneticTable;

  constructor(
    rate: number,
    factor: number,
    controls: Readonly<TapeMagneticControls> = TAPE_MAGNETIC_DEFAULT_CONTROLS,
    table: MagneticTable = TAPE_MAGNETIC,
  ) {
    this.m = NaN;
    this.out = NaN;
    this.resets = 0;
    this.ms = NaN;
    this.invA = NaN;
    this.reversibleGain = NaN;
    this.irreversible = NaN;
    this.irreversibleK = NaN;
    this.dt = NaN;
    this.susceptibility = NaN;
    this.gain = NaN;
    this.alpha = table.alpha;
    this.stateGuard = table.stateGuard;
    this.seriesLimit = table.langevinSeries;
    this.series = Float64Array.from(table.langevinTerms);
    this.slopeSeries = Float64Array.from(table.langevinSlopeTerms);
    this.offsets = Int32Array.from(table.rk4.offsets);
    this.reach = Float64Array.from(table.rk4.reach);
    this.weights = Float64Array.from(table.rk4.weights);
    this.divisor = table.rk4.divisor;
    this.scratch = new Float64Array(1);
    this.table = table;
    this.configure(rate, factor, controls);
    this.reset();
  }

  /**
   * Maps the three controls to Ms, a and c, and recomputes the step, the
   * origin susceptibility and the output gain. Keeps the state. Off the
   * per-sample path: E2 calls it per block from smoothed controls.
   */
  configure(rate: number, factor: number, controls: Readonly<TapeMagneticControls>): void {
    const t = this.table;
    const { drive, width, saturation } = controls;
    if (!(drive >= 0 && drive <= 1 && width >= 0 && width <= 1))
      throw new RangeError('tape core: drive and width must be in [0, 1]');
    if (!(saturation >= 0 && saturation <= 1))
      throw new RangeError('tape core: saturation must be in [0, 1]');
    if (!t.factors.includes(factor) || !(rate > 0 && rate < Infinity))
      throw new RangeError(`tape core: no rate ${rate} at factor ${factor}`);
    const ms = t.saturationFloor + t.saturationScale * (1 - saturation);
    const a = ms / (t.driveFloor + t.driveScale * drive);
    const c = Math.max(0, Math.sqrt(1 - width) - t.reversibleOffset);
    this.ms = ms;
    this.invA = 1 / a;
    this.reversibleGain = c * (ms / a);
    this.irreversible = 1 - c;
    this.irreversibleK = (1 - c) * t.pinning;
    this.dt = 1 / (rate * factor);
    this.susceptibility = originSusceptibility(controls, t);
    this.gain = 1 / Math.max(this.susceptibility, t.susceptibilityFloor);
  }

  /** Demagnetised: the state and the output to zero. The reset counter is kept. */
  reset(): void {
    this.m = 0;
    this.out = 0;
  }

  /**
   * One oversampled RK4 step from the stage point at `stages[at]` (the step's
   * start) through its midpoint at `at + 2` to its end at `at + 4`, each a
   * conditioned field and its time derivative. Writes `m` and `out`; a state
   * past the guard (or not finite) resets to zero and counts.
   */
  tick(stages: Float64Array, at: number): void {
    const start = this.m;
    const alpha = this.alpha;
    const series = this.series;
    const slopeSeries = this.slopeSeries;
    let increment = 0;
    let sum = 0;
    for (let stage = 0; stage < this.offsets.length; stage++) {
      const point = at + this.offsets[stage]!;
      const h = stages[point]!;
      const dh = stages[point + 1]!;
      const trial = start + this.reach[stage]! * increment;
      const q = (h + alpha * trial) * this.invA;
      let langevin: number;
      let langevinSlope: number;
      if (Math.abs(q) < this.seriesLimit) {
        const q2 = q * q;
        langevin = q * (series[0]! + q2 * (series[1]! + q2 * series[2]!));
        langevinSlope = slopeSeries[0]! + q2 * (slopeSeries[1]! + q2 * slopeSeries[2]!);
      } else {
        const scratch = this.scratch;
        scratch[0] = q;
        tanhInPlace(scratch, 0);
        const coth = 1 / scratch[0]!;
        langevin = coth - 1 / q;
        langevinSlope = 1 / (q * q) - (coth * coth - 1);
      }
      const gap = this.ms * langevin - trial;
      const reversible = this.reversibleGain * langevinSlope;
      let pull = 0;
      if (dh > 0 ? gap > 0 : dh < 0 && gap < 0) {
        const pinning = dh > 0 ? this.irreversibleK : -this.irreversibleK;
        pull = (this.irreversible * gap) / (pinning - alpha * gap);
      }
      increment = this.dt * ((dh * (pull + reversible)) / (1 - alpha * reversible));
      sum += this.weights[stage]! * increment;
    }
    const next = start + sum / this.divisor;
    if (Math.abs(next) <= this.stateGuard) {
      this.m = next;
      this.out = next * this.gain;
      return;
    }
    this.m = 0;
    this.out = 0;
    this.resets++;
  }
}

export { TapeMagneticCore, condition, guardField, originSusceptibility };
export type { MagneticTable };
