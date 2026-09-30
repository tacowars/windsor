/** Research integration of the CHOW-derived equation imported read-only from #145.
 * GPL-3.0-only equation: Jatin Chowdhury, revision 604372e4ffd9690c3e283362e4598cb43edbb475.
 * See ../2026-09-30-tape-phase-3/{COPYING,AUDIT.md,hysteresis.ts}.
 * New RK stage driver separates analytic forcing from frozen alpha reconstruction.
 * No recovery is allowed in the reference: invalid state aborts the trial.
 * Tests: scripts/lib/tapeReference.test.mjs.
 */
import { Hysteresis } from '../2026-09-30-tape-phase-3/hysteresis';
import { CORE as C, EXPERIMENT as E, REFERENCE as R } from './referenceConstants';
export type Signal = { bins: number[]; amplitude: number; sign: number };
export function windowPlan(signal: Signal) {
  return signal.bins.length === 1 &&
    signal.bins[0] === E.bins[0] &&
    signal.amplitude === R.normalLevels[0]
    ? R.quietLow
    : { periods: R.periods, principalPeriod: R.principalPeriod, extendedPeriod: R.extendedPeriod };
}
export function forcing(t: number, signal: Signal): [number, number] {
  let h = 0,
    d = 0;
  for (const bin of signal.bins) {
    const w = (2 * Math.PI * bin) / E.frames;
    h += Math.sin(w * t);
    d += w * Math.cos(w * t);
  }
  const gain = (signal.sign * signal.amplitude) / signal.bins.length;
  return [gain * h, gain * d]; // derivative per HOST sample; rate cancels in dm/dt.
}
export function rkStep(core: Hysteresis, points: number[], dt: number): number {
  const [h0, d0, h1, d1, h2, d2] = points;
  const k1 = dt * core.slope(core.m, h0, d0);
  const k2 = dt * core.slope(core.m + k1 / 2, h1, d1);
  const k3 = dt * core.slope(core.m + k2 / 2, h1, d1);
  const k4 = dt * core.slope(core.m + k3, h2, d2);
  const next = core.m + (k1 + 2 * k2 + 2 * k3 + k4) / 6;
  if (!Number.isFinite(next) || Math.abs(next) > C.stateLimit)
    throw Error('Invalid reference state');
  return (core.m = next);
}
export function analytic(options: {
  rate: number;
  factor: number;
  signal: Signal;
  periods?: number;
}) {
  const { rate, factor, signal } = options;
  const plan = windowPlan(signal);
  const periods = options.periods ?? plan.periods;
  const core = new Hysteresis(rate * factor);
  const output = new Float64Array(E.frames * periods);
  // Precompute one coherent period of forcing. Exact analytic values at all RK stages.
  const fields = new Float64Array(2 * E.frames * factor * 2);
  for (let i = 0; i < fields.length / 2; i++) fields.set(forcing(i / (2 * factor), signal), 2 * i);
  const points = new Array<number>(6);
  let peak = 0;
  for (let i = 0; i < output.length * factor; i++) {
    if (i % factor === 0) output[i / factor] = core.m;
    for (let stage = 0; stage < 3; stage++) {
      const index = ((2 * i + stage) * 2) % fields.length;
      points[2 * stage] = fields[index];
      points[2 * stage + 1] = fields[index + 1] * rate;
    }
    rkStep(core, points, 1 / (rate * factor));
    peak = Math.max(peak, Math.abs(core.m));
  }
  return { output, plan, peak, final: core.m, resets: 0, clips: 0 };
}
/** Same sampled H and alpha-D endpoints as #145, held fixed during subdivision.
 * H and D are independently linearly interpolated, exactly as its RK stages do.
 * D is NOT claimed to be the derivative of that piecewise-linear H trajectory.
 */
export class FrozenCore extends Hysteresis {
  constructor(
    rate: number,
    readonly subdivisions = R.subdivisions.at(-1)!,
  ) {
    super(rate);
  }
  override tick(input: number): number {
    if (!Number.isFinite(input) || Math.abs(input) > C.inputLimit)
      throw Error('Reference input outside unclipped domain');
    const d =
      (1 + C.derivativeAlpha) * this.rate * (input - this.h) - C.derivativeAlpha * this.derivative;
    const points = new Array<number>(6);
    for (let i = 0; i < this.subdivisions; i++) {
      for (let stage = 0; stage < 3; stage++) {
        const f = (i + stage / 2) / this.subdivisions;
        points[2 * stage] = this.h + f * (input - this.h);
        points[2 * stage + 1] = this.derivative + f * (d - this.derivative);
      }
      rkStep(this, points, this.period / this.subdivisions);
    }
    this.h = input;
    this.derivative = d;
    return this.m;
  }
}
/** Independent Langevin evaluation: moments of exp(q*u), -1 <= u <= 1.
 * L = E[u], L' = Var[u]. Simpson quadrature avoids coth and small-q series.
 * Original numerical check, no upstream implementation copied.
 */
export function momentSlope(options: {
  m: number;
  h: number;
  velocity: number;
  panels?: number;
}): number {
  const { m, h, velocity, panels = R.quadraturePanels } = options;
  const ms = C.saturationFloor + C.saturationScale * (1 - C.saturation);
  const a = ms / (C.driveFloor + C.driveScale * C.drive);
  const c = Math.sqrt(1 - C.width) - C.reversibleOffset;
  const q = (h + C.alpha * m) / a;
  let mass = 0,
    first = 0,
    second = 0;
  for (let i = 0; i <= panels; i++) {
    const u = -1 + (2 * i) / panels;
    const weight = (i === 0 || i === panels ? 1 : i % 2 ? 4 : 2) * Math.exp(q * u - Math.abs(q));
    mass += weight;
    first += weight * u;
    second += weight * u * u;
  }
  const mean = first / mass,
    susceptibility = (ms / a) * (second / mass - mean * mean);
  const gap = ms * mean - m,
    direction = Math.sign(velocity);
  const irreversible =
    direction * gap > 0 ? gap / (direction * C.k - (C.alpha * gap) / (1 - c)) : 0;
  return (velocity * (irreversible + c * susceptibility)) / (1 - C.alpha * c * susceptibility);
}
