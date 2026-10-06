/* eslint-disable no-magic-numbers -- DSP: the trapezoidal step's 2x − s, the rational's derivative factors and the interpolation are the algorithm; the tunables are fmConstants.ts and ladderTables.ts */
/**
 * The Acid Ladder (windsor#573, record `2026-10-04-acid-ladder-filter-mode`):
 * the Roland TB-303's four-stage diode ladder lowpass, after Stinchcombe's
 * circuit analysis, as four coupled capacitor states in units of 2 V_T,
 *
 *   c₁ τ ẋ₁ = tanh(x₂ − x₁) − tanh(u)
 *      τ ẋ₂ = tanh(x₃ − x₂) − tanh(x₂ − x₁)
 *      τ ẋ₃ = tanh(x₄ − x₃) − tanh(x₃ − x₂)
 *      τ ẋ₄ = −tanh(x₄)     − tanh(x₄ − x₃)
 *   y = x₄,   u = in + k · hp(y),
 *
 * the bottom capacitor c₁ = `LADDER_BOTTOM_CAP` of the others, the input
 * and the feedback saturating together in the input pair, the feedback
 * through a one-pole high-pass (decisions 3 and 4). Linearised, the chain's
 * polynomial is s⁴ + 6.727 s³ + 14.142 s² + 9.514 s + 1 in units of
 * ω_c = 2^¼ / τ, the cutoff.
 *
 * The solver (decision 6): the trapezoidal rule in integrator-memory form,
 * the engine's TPT filters' own: each state keeps s = x + h f, the step
 * solves x⁺ = s + h f(x⁺) and then s ← 2x⁺ − s, so the input is read once,
 * at the new endpoint. h is the prewarped half-step over τ,
 * tan(π f_c / f_s) / 2^¼, which `tuneLadder` (`ladderTune.ts`) sets with
 * k and the high-pass's coefficient once per control block. The high-pass
 * is a TPT one-pole on x₄ whose new-endpoint output enters u. Each sample
 * takes a fixed `steps` Newton steps on the four states from s, the 4 × 4
 * Jacobian solved written out (tridiagonal with the feedback's corner,
 * eliminated from the bottom up; every pivot is at least 1), so every
 * sample costs the same and the render is deterministic. `tanh` is the
 * rational of `ladderTables.ts` and its slope the rational's own
 * derivative: no `Math` transcendental, so the same bits on arm64 and x64.
 * `oversample` 2 runs two sub-steps a sample on a linearly interpolated
 * input and decimates through `LADDER_DECIMATOR`. The voice ships
 * `LADDER_OVERSAMPLE` 2 with `LADDER_NEWTON_STEPS` 3 (windsor#593, record
 * `2026-10-04-acid-ladder-ships-2x-and-reso-17-2`), which replaced decision
 * 6's 1× with four steps, whose aliasing tacowars heard as a high whine at
 * open cutoff and high Reso; 1 stays selectable for the research bench.
 *
 * The output mix (windsor#577): the TB-303's second resonance path, the
 * Reso pot's wiper into the VCA beside the ladder's output, so what leaves
 * is y + `mixGain` · hp_mix(y), y the ladder's output, hp_mix a TPT
 * one-pole high-pass at `LADDER_MIX_HP_HZ` and `mixGain` = `LADDER_MIX_GAIN` × p, p
 * the Reso knob's place (`tuneLadder` sets both). A post-stage, once per
 * output sample after the solve: it changes nothing in the loop. With
 * `mixGain` 0 the sum is skipped, so at the knob's bottom the output is the
 * solve's to the bit; the high-pass runs either way, so a Reso that rises
 * mid-note meets a settled state.
 *
 * The makeup (windsor#587): last, the output times `makeup` =
 * (1 + k)^`LADDER_MAKEUP_POWER`, which `tuneLadder` works out with k. A
 * scalar after everything nonlinear, so the spectrum at any Reso is the
 * circuit's up to the gain; 1 at the knob's bottom, where the output is the
 * solve's to the bit.
 *
 * At the Reso knob's top k is `LADDER_FEEDBACK_MAX`, 17.2, and the makeup
 * √18.2 (+12.6 dB).
 *
 * Level and polarity (decision 7): the sample enters times
 * `LADDER_INPUT_SCALE` and leaves divided by it, negated, so the mode has
 * the Lowpass mode's polarity.
 *
 * Invariants: `process` takes its sample from `point` and leaves it there,
 * and its helpers pass their operands in fields, so no double crosses a
 * call (worklet rule 2); nothing here allocates after the constructor;
 * every double field is born NaN (rule 7); `reset` zeroes every state, the
 * two high-passes' included, at a note's start; `quiet` is every state under
 * `DORMANT_FILTER_STATE`. `ladder.test.ts` pins the saturator, the
 * polynomial, the 2× response with and without the mix and the mix's
 * absence at p = 0, and the makeup as a gain alone; `ladderLimits.test.ts` the
 * convergence, the bounds, the threshold, the harmonics and the reset;
 * `synth/fmProcessorFilterLadder.test.ts` the voice.
 */

import {
  CTRL_INTERVAL_LONG,
  DORMANT_FILTER_STATE,
  LADDER_BOTTOM_CAP,
  LADDER_INPUT_SCALE,
  LADDER_NEWTON_STEPS,
  LADDER_OVERSAMPLE,
} from './fmConstants';
import { LADDER_DECIMATOR, LADDER_SATURATOR } from './ladderTables';

const INV_BOTTOM_CAP = 1 / LADDER_BOTTOM_CAP;
const OUTPUT_SCALE = 1 / LADDER_INPUT_SCALE;

/** The rational's coefficients, and its derivative's: (x P)' = Σ (2i + 1) Pᵢ x²ⁱ, Q' = x Σ 2i Qᵢ x²⁽ⁱ⁻¹⁾. */
const SAT_P = LADDER_SATURATOR.numerator;
const SAT_Q = LADDER_SATURATOR.denominator;
const P0 = SAT_P[0],
  P1 = SAT_P[1],
  P2 = SAT_P[2],
  P3 = SAT_P[3];
const Q0 = SAT_Q[0],
  Q1 = SAT_Q[1],
  Q2 = SAT_Q[2],
  Q3 = SAT_Q[3];
const DP1 = 3 * P1,
  DP2 = 5 * P2,
  DP3 = 7 * P3;
const DQ1 = 2 * Q1,
  DQ2 = 4 * Q2,
  DQ3 = 6 * Q3;
const SAT_LIMIT = LADDER_SATURATOR.limit;

class Ladder {
  /** Each state's integrator memory, s = x + h f(x), from the last sample. */
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  /** The feedback high-pass's integrator memory, and the output mix's. */
  hpS: number;
  mixS: number;
  /** The last solve's output state, x₄. */
  y: number;
  /**
   * Per block (`tuneLadder`): the prewarped half-step over τ, the feedback
   * gain, the feedback high-pass's G = g / (1 + g), the output mix's gain
   * and its high-pass's G, and the makeup, (1 + k)^`LADDER_MAKEUP_POWER`.
   */
  h: number;
  k: number;
  hpG: number;
  mixGain: number;
  mixG: number;
  makeup: number;
  /** `tuneLadder`'s inputs: the cutoff (Hz) and the Reso knob's value. */
  cutoffHz: number;
  resonance: number;
  /** What the coefficients were last worked out for (NaN: not yet), so an unchanged input costs a compare. */
  tunedHz: number;
  tunedResonance: number;
  tunedRate: number;
  /** Newton steps a sample, and sub-steps a sample (1 or 2). */
  steps: number;
  oversample: number;
  /** `process`'s sample, in and out. */
  point: number;
  /** The last sample's scaled input, which a sub-step interpolates from. */
  lastIn: number;
  /** `saturate`'s operand, value and slope. */
  satIn: number;
  satOut: number;
  satSlope: number;
  /** The oversampled outputs, newest first, and the decimator's taps over them. */
  history: Float64Array;
  taps: Float64Array;
  /** The tuning's one slot for the portable tangent and log. */
  slot: Float64Array;
  /**
   * A render chunk's samples into the ladder, which the voice's render
   * loops leave here for `renderVoiceLadder` (`voiceLadder.ts`): a chunk is
   * at most one control interval, so at most a render quantum.
   */
  chunk: Float64Array;

  constructor() {
    // Rule 7: each double field is born a double (NaN), before its start value (windsor#233).
    this.s1 = this.s2 = this.s3 = this.s4 = this.hpS = this.mixS = this.y = NaN;
    this.h = this.k = this.hpG = this.mixGain = this.mixG = this.makeup = NaN;
    this.cutoffHz = this.resonance = NaN;
    this.tunedHz = this.tunedResonance = this.tunedRate = NaN;
    this.point = this.lastIn = this.satIn = this.satOut = this.satSlope = NaN;
    this.s1 = this.s2 = this.s3 = this.s4 = this.hpS = this.mixS = this.y = 0;
    this.h = 0;
    this.k = 0;
    this.hpG = 0;
    this.mixGain = 0;
    this.mixG = 0;
    this.makeup = 1;
    this.cutoffHz = 0;
    this.resonance = 0;
    this.point = this.lastIn = this.satIn = this.satOut = this.satSlope = 0;
    this.steps = LADDER_NEWTON_STEPS;
    this.oversample = LADDER_OVERSAMPLE;
    this.taps = Float64Array.from(LADDER_DECIMATOR);
    this.history = new Float64Array(this.taps.length);
    this.slot = new Float64Array(1);
    this.chunk = new Float64Array(CTRL_INTERVAL_LONG);
  }

  /** A new note: every state from rest, the high-passes' and the decimator's included. The tuning carries over. */
  reset(): void {
    this.s1 = 0;
    this.s2 = 0;
    this.s3 = 0;
    this.s4 = 0;
    this.hpS = 0;
    this.mixS = 0;
    this.y = 0;
    this.lastIn = 0;
    this.history.fill(0);
  }

  /** Every state under the dormancy floor (#547): the ladder has stopped ringing. */
  static quiet(ladder: Ladder): boolean {
    const floor = DORMANT_FILTER_STATE;
    return (
      Math.abs(ladder.s1) <= floor &&
      Math.abs(ladder.s2) <= floor &&
      Math.abs(ladder.s3) <= floor &&
      Math.abs(ladder.s4) <= floor &&
      Math.abs(ladder.hpS) <= floor &&
      Math.abs(ladder.mixS) <= floor
    );
  }

  /** `satIn` through the rational tanh: its value in `satOut`, its slope in `satSlope`. */
  saturate(): void {
    const x = this.satIn;
    if (x >= SAT_LIMIT) {
      this.satOut = 1;
      this.satSlope = 0;
      return;
    }
    if (x <= -SAT_LIMIT) {
      this.satOut = -1;
      this.satSlope = 0;
      return;
    }
    const z = x * x;
    const p = P0 + z * (P1 + z * (P2 + z * P3));
    const q = Q0 + z * (Q1 + z * (Q2 + z * Q3));
    const dp = P0 + z * (DP1 + z * (DP2 + z * DP3));
    const dq = DQ1 + z * (DQ2 + z * DQ3);
    const r = 1 / q;
    this.satOut = x * p * r;
    this.satSlope = (dp * q - z * p * dq) * r * r;
  }

  /**
   * `point` through the ladder, written back to `point`: `oversample`
   * trapezoidal steps on the input (at 2×, the first on the midpoint from
   * the last sample's), each `steps` Newton steps on the four states from
   * their memories, after which the memories and the high-pass advance;
   * at 1× the output is the last x₄, at 2× the decimator's sum over them,
   * then the output mix on it, then the makeup.
   */
  // One Newton solve read top to bottom: the residual, the Jacobian and its
  // elimination share every local, and a helper per part would pass them
  // through fields each step. It stays one call, too long for V8 to inline
  // into the render loops, so the kernel's inlining budget is not spent on
  // it (the Formant lesson, worklet rule 2; `bench.mjs` in the research).
  // eslint-disable-next-line max-lines-per-function -- one solve, see above
  process(): void {
    const input = this.point * LADDER_INPUT_SCALE;
    const m = this.oversample;
    const last = this.lastIn;
    const steps = this.steps;
    const h = this.h;
    const a = h * INV_BOTTOM_CAP;
    const hpG = this.hpG;
    const kh = this.k * (1 - hpG);
    const history = this.history;
    for (let sub = 1; sub <= m; sub++) {
      const drive = sub === m ? input : last + ((input - last) * sub) / m;
      const hpS = this.hpS;
      const s1 = this.s1,
        s2 = this.s2,
        s3 = this.s3,
        s4 = this.s4;
      let x1 = s1,
        x2 = s2,
        x3 = s3,
        x4 = s4;
      for (let it = 0; it < steps; it++) {
        this.satIn = x2 - x1;
        this.saturate();
        const t01 = this.satOut,
          d01 = this.satSlope;
        this.satIn = x3 - x2;
        this.saturate();
        const t12 = this.satOut,
          d12 = this.satSlope;
        this.satIn = x4 - x3;
        this.saturate();
        const t23 = this.satOut,
          d23 = this.satSlope;
        this.satIn = x4;
        this.saturate();
        const t4 = this.satOut,
          d4 = this.satSlope;
        this.satIn = drive + kh * (x4 - hpS);
        this.saturate();
        const tu = this.satOut,
          du = this.satSlope;
        // The residual's negative, r = s + h f(x) − x, row by row.
        const r1 = s1 - x1 + a * (t01 - tu);
        const r2 = s2 - x2 + h * (t12 - t01);
        const r3 = s3 - x3 + h * (t23 - t12);
        const r4 = s4 - x4 - h * (t4 + t23);
        // The Jacobian I − h ∂f/∂x: tridiagonal, symmetric below row 1, and
        // the feedback's corner at (1, 4).
        const j11 = 1 + a * d01,
          j12 = -a * d01,
          j14 = a * du * kh;
        const j21 = -h * d01,
          j22 = 1 + h * (d01 + d12),
          j23 = -h * d12;
        const j33 = 1 + h * (d12 + d23),
          j34 = -h * d23;
        const j44 = 1 + h * (d23 + d4);
        // Eliminate from the bottom up, each of x₂..x₄'s steps an affine
        // function of x₁'s, then row 1 gives x₁'s.
        const m4 = 1 / j44;
        const m3 = 1 / (j33 - j34 * j34 * m4);
        const q3 = r3 - j34 * m4 * r4;
        const m2 = 1 / (j22 - j23 * j23 * m3);
        const q2 = r2 - j23 * q3 * m3;
        const a2 = q2 * m2,
          b2 = -j21 * m2;
        const a3 = (q3 - j23 * a2) * m3,
          b3 = -j23 * b2 * m3;
        const a4 = (r4 - j34 * a3) * m4,
          b4 = -j34 * b3 * m4;
        const dx1 = (r1 - j12 * a2 - j14 * a4) / (j11 + j12 * b2 + j14 * b4);
        x1 += dx1;
        x2 += a2 + b2 * dx1;
        x3 += a3 + b3 * dx1;
        x4 += a4 + b4 * dx1;
      }
      this.s1 = 2 * x1 - s1;
      this.s2 = 2 * x2 - s2;
      this.s3 = 2 * x3 - s3;
      this.s4 = 2 * x4 - s4;
      const v = (x4 - hpS) * hpG;
      const lp = v + hpS;
      this.hpS = lp + v;
      this.y = x4;
      if (m !== 1) {
        for (let j = history.length - 1; j > 0; j--) history[j] = history[j - 1];
        history[0] = x4;
      }
    }
    this.lastIn = input;
    let out = this.y;
    if (m !== 1) {
      const taps = this.taps;
      out = 0;
      for (let j = 0; j < taps.length; j++) out += taps[j] * history[j];
    }
    // The output mix's high-pass, a TPT one-pole on the output; its sum only with the Reso knob up.
    const mixS = this.mixS;
    const mv = (out - mixS) * this.mixG;
    const mlp = mv + mixS;
    this.mixS = mlp + mv;
    const mixGain = this.mixGain;
    if (mixGain !== 0) out += mixGain * (out - mlp);
    // The makeup (windsor#587): a scalar, the last thing the ladder does; 1 at the Reso knob's bottom.
    out *= this.makeup;
    this.point = -out * OUTPUT_SCALE;
  }
}

export { Ladder };
