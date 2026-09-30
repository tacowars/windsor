/**
 * The magnetic Tape core's tunables (windsor#219, epic #146 milestone E1):
 * the oversampling FIR pair, the field guard and knee, the state guard, the
 * Jiles–Atherton constants, the mapping of the core's three internal controls
 * to the model's parameters, and the Drive gain curve with `driveGain`.
 *
 * The equation's structure and the Langevin function's series are physics
 * and mathematics (Jiles and Atherton, *Theory of ferromagnetic hysteresis*,
 * J. Magn. Magn. Mater. 61, 1986; Chowdhury, *Real-time physical modelling
 * for analog tape machines*, DAFx 2019). The tuning below (`alpha`, `k`, the
 * control mapping, the knee and its asymptote, the guards) was chosen to
 * match the domain Windsor's research qualified
 * (`docs/log/2026-09-30-tape-magnetic-integration-design.md` and the records
 * it follows); `tapeMagnetic.test.ts`'s equivalence test against the research
 * ruler is the evidence. Nothing here is imported from `docs/research/`.
 *
 * The worklet sources `worklet/tape/tapeMagnetic.ts` and `tapeOversample.ts`
 * read this file; it also compiles under the engine's main project. Wiring
 * into the Tape insert is E2's (`tapeDsp.ts`), so nothing here is audible yet.
 */
import { TAPE_BOUNDS } from './tapeConstants';
import { exp2 } from './tapePortableMath';

export const TAPE_MAGNETIC = {
  /** FIR span in host samples: the pair's fixed delay, and each FIR's `span × factor + 1` taps (#207). */
  span: 48,
  /** Kernel cutoff in cycles per host sample (0.45 fs), the family #207 qualified. */
  cutoff: 0.45,
  /** Blackman window terms: `a0 + a1 cos(2πt/span) + a2 cos(4πt/span)`, t centred. */
  blackman: [0.42, 0.5, 0.08],
  /** The oversampling factors the core may be built at; decision 1 of the design record. */
  factors: [2, 4],
  defaultFactor: 2,
  /** Stage points per oversampled step past its start: the RK4 midpoint and end. */
  stagesPerStep: 2,
  /**
   * The classical RK4 tableau over the stage buffer (`[h, dh]` pairs): each
   * stage's offset in the buffer (start, midpoint twice, end), the fraction of
   * the previous stage's increment its trial state takes, its weight, and the
   * weights' divisor.
   */
  rk4: {
    offsets: [0, 2, 2, 4],
    reach: [0, 0.5, 0.5, 1],
    weights: [1, 2, 2, 1],
    divisor: 6,
  },
  /** The odd C1 knee: identity to |h| = knee, then compressing toward the asymptote. */
  knee: 1,
  asymptote: 4,
  /** The field guard: the source field is clipped to ±this before the knee (design decision 3). */
  fieldGuard: 4,
  /** The state guard: a magnetization past this magnitude (or not finite) resets to zero, counted. */
  stateGuard: 20,
  /** Inter-domain coupling α and pinning k of the Jiles–Atherton equation, in field units. */
  alpha: 1.6e-3,
  pinning: 0.47875,
  /** Below this |Q| the Langevin function and its slope use their Taylor series. */
  langevinSeries: 0.01,
  /** L(q) ≈ q (1/3 − q²/45 + 2q⁴/945) and L′(q) ≈ 1/3 − q²/15 + 2q⁴/189 near zero. */
  langevinTerms: [1 / 3, -1 / 45, 2 / 945],
  langevinSlopeTerms: [1 / 3, -1 / 15, 2 / 189],
  /** L′(0): the anhysteretic curve's slope at the origin, per unit Q. */
  langevinOriginSlope: 1 / 3,
  /** Saturation control to Ms: `floor + scale (1 − saturation)`. */
  saturationFloor: 0.5,
  saturationScale: 1.5,
  /** Drive control to the shape a: `Ms / (floor + scale drive)`. */
  driveFloor: 0.01,
  driveScale: 6,
  /** Width control to the reversible coefficient: `max(0, √(1 − width) − offset)`. */
  reversibleOffset: 0.01,
  /**
   * The lowest origin susceptibility a row may have (design decision 6). At the
   * width endpoint the reversible coefficient clamps to zero, the susceptibility
   * is zero and unity normalisation is undefined; the core still integrates
   * there, but its output gain is capped at `1 / floor`. Every sampled control
   * point of the dynamic-survival record off that endpoint sits above it.
   */
  susceptibilityFloor: 1e-3,
};

/** The core's three internal controls, each in [0, 1]: not a Windsor knob (design decision 6). */
export interface TapeMagneticControls {
  drive: number;
  width: number;
  saturation: number;
}

/** The research centre every tape model starts at: a sampled point of the survival domain. */
export const TAPE_MAGNETIC_DEFAULT_CONTROLS: Readonly<TapeMagneticControls> = {
  drive: 0.5,
  width: 0.5,
  saturation: 0.5,
};

/** Drive, in the Tape insert's existing dB bounds, to a plain gain into the core. */
export const TAPE_DRIVE_GAIN = {
  bounds: TAPE_BOUNDS.drive,
  /**
   * The gain at either bound, in octaves of amplitude: 2 is ×4 at the maximum
   * and ¼ at the minimum (±12.04 dB). Octaves, so the curve is `exp2`, exact
   * on every platform, where `4 ** x` is not.
   */
  boundOctaves: 2,
};

/**
 * The source-field gain for a Drive value (design decision 3): unity at 0,
 * `2^boundOctaves` at the upper bound, its reciprocal at the lower, linear in dB
 * between, and clamped outside. Exact at 0 and at both bounds.
 */
export function driveGain(drive: number, table = TAPE_DRIVE_GAIN): number {
  const [low, high] = table.bounds;
  const clamped = Math.min(high, Math.max(low, drive));
  const position = clamped >= 0 ? clamped / high : -clamped / low;
  return exp2(table.boundOctaves * position);
}
