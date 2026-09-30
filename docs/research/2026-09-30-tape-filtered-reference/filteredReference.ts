/** Offline full filtered reference for the read-only CHOW-derived equation.
 * GPL-3.0-only core: Jatin Chowdhury, revision 604372e4ffd9690c3e283362e4598cb43edbb475.
 * Attribution/COPYING: ../2026-09-30-tape-phase-3/. No new upstream code.
 * Every state is at its timestamp, before advancing. Invalid trials abort, never reset.
 */
import { Hysteresis, type Solver } from '../2026-09-30-tape-phase-3/hysteresis';
import { windowPlan, type Signal } from '../2026-09-30-tape-reference/reference';
import { CORE as C, EXPERIMENT as E, FILTERED as F } from './filteredConstants';
import { type Field, kernel, NORM } from './reconstruction';

export function step(core: Hysteresis, points: number[], dt: number, solver: Solver): number {
  const [h0, d0, h1, d1, h2, d2] = points;
  const k1 = dt * core.slope(core.m, h0, d0);
  const k2 = dt * core.slope(core.m + k1 / 2, h1, d1);
  let next = core.m + k2;
  if (solver === 'rk4') {
    const k3 = dt * core.slope(core.m + k2 / 2, h1, d1);
    const k4 = dt * core.slope(core.m + k3, h2, d2);
    next = core.m + (k1 + 2 * k2 + 2 * k3 + k4) / 6;
  }
  if (!Number.isFinite(next) || Math.abs(next) > C.stateLimit)
    throw Error('Invalid reference state');
  core.m = next;
  return next;
}

/** Composite trapezoid convolution, fixed continuous kernel, no per-grid gain fit.
 * Endpoints have zero weight because the Blackman kernel vanishes there.
 */
export function playback(states: Float64Array, factor: number, frames: number): Float64Array {
  const taps = Float64Array.from(
    { length: E.firSpan * factor + 1 },
    (_, i) => kernel(i / factor - E.firSpan / 2)[0] / (factor * NORM),
  );
  const output = new Float64Array(frames);
  for (let n = 0; n < frames; n++) {
    let sum = 0;
    const end = n * factor;
    for (let j = 0; j <= Math.min(end, taps.length - 1); j++) sum += taps[j] * states[end - j];
    output[n] = sum;
  }
  return output;
}

// eslint-disable-next-line max-lines-per-function -- One offline state trajectory with a single abort boundary and its observations.
export function render(options: {
  rate: number;
  factor: number;
  signal: Signal;
  field: Pick<Field, 'grid' | 'bins' | 'at'>;
  solver?: Solver;
  periods?: number;
  frames?: number;
  identity?: boolean;
}) {
  const { rate, factor, signal, field, solver = 'rk4', identity = false } = options;
  if (field.grid !== 2 * factor || field.bins.join() !== signal.bins.join())
    throw Error('Field does not match integration grid/signal');
  const plan = windowPlan(signal);
  const frames = options.frames ?? E.frames * (options.periods ?? plan.periods);
  const core = new Hysteresis(rate * factor, solver);
  const states = new Float64Array(frames * factor);
  const points = new Array<number>(6);
  const gain = signal.sign * signal.amplitude;
  let peak = 0,
    fieldPeak = 0,
    failure: string | null = null;
  for (let i = 0; i < states.length; i++) {
    states[i] = identity ? gain * field.at(2 * i) : core.m;
    try {
      for (let stage = 0; stage < 3; stage++) {
        points[2 * stage] = gain * field.at(2 * i + stage);
        points[2 * stage + 1] = gain * rate * field.at(2 * i + stage, true);
        fieldPeak = Math.max(fieldPeak, Math.abs(points[2 * stage]));
      }
      if (fieldPeak > C.inputLimit) throw Error('Reference input outside unclipped domain');
      if (!identity) step(core, points, 1 / (rate * factor), solver);
      peak = Math.max(peak, Math.abs(states[i]), Math.abs(core.m));
    } catch (error) {
      failure = String(error);
      states.fill(NaN, i);
      break;
    }
  }
  const output = playback(states, factor, frames);
  const raw = Float64Array.from({ length: frames }, (_, n) => states[n * factor]);
  const frozen =
    factor >= F.observationFactor
      ? playback(
          Float64Array.from(
            { length: frames * F.observationFactor },
            (_, i) => states[(i * factor) / F.observationFactor],
          ),
          F.observationFactor,
          frames,
        )
      : null;
  return {
    output,
    raw,
    frozen,
    plan,
    peak,
    fieldPeak,
    final: core.m,
    resets: 0,
    clips: 0,
    failure,
    finite: states.every(Number.isFinite),
  };
}
