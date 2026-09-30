/** Offline diagnostic rendering. All #145 code is imported without mutation on disk. */
import { Hysteresis, type Solver } from '../2026-09-30-tape-phase-3/hysteresis';
import { ResampledHysteresis, coefficients } from '../2026-09-30-tape-phase-3/resampler';
import { EXPERIMENT as E, REFERENCE as R } from './referenceConstants';
import { forcing, FrozenCore, windowPlan, type Signal } from './reference';
export function sampled(options: {
  rate: number;
  factor: number;
  signal: Signal;
  solver?: Solver;
  filtered?: boolean;
  subdivisions?: number;
  identity?: boolean;
  periods?: number;
}) {
  const {
    rate,
    factor,
    signal,
    solver = 'rk4',
    filtered = false,
    subdivisions,
    identity = false,
  } = options;
  const dsp = new ResampledHysteresis({ rate, factor, solver, identity });
  const core = subdivisions ? new FrozenCore(rate * factor, subdivisions) : dsp.core;
  if (subdivisions) dsp.core.tick = (x) => core.tick(x);
  const plan = windowPlan(signal);
  const output = new Float64Array(E.frames * (options.periods ?? plan.periods));
  let peak = 0;
  for (let i = 0; i < output.length * (filtered ? 1 : factor); i++) {
    const x = forcing(i / (filtered ? 1 : factor), signal)[0];
    const y = filtered ? dsp.tick(x) : core.tick(x);
    peak = Math.max(peak, Math.abs(y));
    if (filtered || i % factor === 0) output[i / (filtered ? 1 : factor)] = y;
  }
  return { output, plan, peak, final: core.m, resets: core.resets, clips: core.clips };
}
export function window(output: Float64Array, period = R.principalPeriod, delay = 0) {
  // Use actual preceding samples, never circular alignment of an unsettled record.
  const start = period * E.frames - delay;
  if (start < 0 || start + E.frames > output.length) throw Error('Window outside rendered history');
  return output.slice(start, start + E.frames);
}
export function transfer(actual: Float64Array, reference: Float64Array, bin: number) {
  const project = (xs: Float64Array) => {
    let re = 0,
      im = 0;
    for (let i = 0; i < xs.length; i++) {
      const angle = (2 * Math.PI * bin * i) / xs.length;
      re += xs[i] * Math.cos(angle);
      im -= xs[i] * Math.sin(angle);
    }
    return [re, im];
  };
  const [ar, ai] = project(actual),
    [br, bi] = project(reference);
  return {
    gainDb: 10 * Math.log10((ar * ar + ai * ai) / (br * br + bi * bi)),
    phaseRadians: Math.atan2(ai * br - ar * bi, ar * br + ai * bi),
  };
}
export function filterEvidence(factor: number, bin: number) {
  const taps = coefficients(factor),
    center = (taps.length - 1) / 2;
  let response = 0;
  for (let i = 0; i < taps.length; i++)
    response += taps[i] * Math.cos((2 * Math.PI * bin * (i - center)) / (E.frames * factor));
  const dsp = new ResampledHysteresis({ rate: E.benchmarkRate, factor, identity: true });
  const impulse = Float64Array.from({ length: E.blockSize }, (_, i) => dsp.tick(i === 0 ? 1 : 0));
  return {
    factor,
    bin,
    measuredDelay: impulse.indexOf(Math.max(...impulse)),
    dcGain: impulse.reduce((a, b) => a + b),
    carrierPairGainDb: factor === 1 ? 0 : 40 * Math.log10(Math.abs(response)),
  };
}
export function boundary(rate: number, solver: Solver, factor: number) {
  const core = new Hysteresis(rate * factor, solver);
  const rows = [];
  for (const level of E.stressLevels) {
    const values = Float64Array.from({ length: E.blockSize * factor }, () => core.tick(level));
    rows.push({
      level,
      first: values[0],
      last: values.at(-1),
      finite: values.every(Number.isFinite),
      m: core.m,
      h: core.h,
      derivative: core.derivative,
      resets: core.resets,
      clips: core.clips,
    });
  }
  return { rate, solver, factor, rows };
}
/** Reference gate for nonzero tone trials; silence/recovery cannot earn qualification. */
export function qualifies(
  errors: number[],
  states: {
    finite: boolean;
    resets: number;
    clips: number;
    peak: number;
    extendedSettlingDb: number;
  }[],
  gate: number,
) {
  return (
    errors.length >= 2 &&
    states.length === errors.length + 1 &&
    errors.every((error) => error <= gate) &&
    states.every(
      (state) =>
        state.finite &&
        state.peak > 0 &&
        !state.resets &&
        !state.clips &&
        state.extendedSettlingDb <= R.settlingGateDb,
    )
  );
}
