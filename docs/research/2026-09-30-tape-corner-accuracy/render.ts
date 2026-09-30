/** windsor#215 candidate render: RK4 on the knee-conditioned system inside an FIR pair.
 * GPL-3.0-only core: Jatin Chowdhury, 604372e4ffd9690c3e283362e4598cb43edbb475.
 * See ../2026-09-30-tape-phase-3/{COPYING,AUDIT.md,hysteresis.ts}. integrate (and through
 * it configured, stage and step), windowPlan, ResampledHysteresis and
 * SymmetricResampledHysteresis (with their `coefficients`) are imported unchanged.
 * New here only because reconstruction.ts fixes its kernel at EXPERIMENT.firSpan: the same
 * continuous Blackman-sinc and derivative with the span as a parameter. Offline; allocates.
 */
import { integrate } from '../2026-09-30-tape-dynamic-survival/program';
import { ResampledHysteresis } from '../2026-09-30-tape-phase-3/resampler';
import { SymmetricResampledHysteresis } from '../2026-09-30-tape-resampler/symmetric';
import { windowPlan, type Signal } from '../2026-09-30-tape-reference/reference';
import {
  CONDITIONING as K,
  CORNER,
  EXPERIMENT as E,
  FILTERED as F,
  type Corner,
  type Setting,
} from './cornerConstants';

/** reconstruction.ts's kernel(t), operation for operation, with `span` in place of firSpan. */
export function spanKernel(t: number, span: number): [number, number] {
  const half = span / 2;
  if (Math.abs(t) >= half) return [0, 0];
  const a = 2 * Math.PI * E.cutoff;
  const z = a * t;
  const sinc =
    Math.abs(z) < F.kernelSeriesRadius ? 1 - (z * z) / 6 + z ** 4 / 120 : Math.sin(z) / z;
  const derivative =
    Math.abs(z) < F.kernelSeriesRadius
      ? a * (-z / 3 + z ** 3 / 30)
      : (a * (z * Math.cos(z) - Math.sin(z))) / (z * z);
  const b = Math.PI / half;
  const w = 0.42 + 0.5 * Math.cos(b * t) + 0.08 * Math.cos(2 * b * t);
  const wd = -0.5 * b * Math.sin(b * t) - 0.16 * b * Math.sin(2 * b * t);
  return [2 * E.cutoff * sinc * w, 2 * E.cutoff * (derivative * w + sinc * wd)];
}

export function spanNorm(span: number, panels = F.normalizationPanels): number {
  let sum = 0;
  for (let i = 0; i <= panels; i++) {
    const weight = i === 0 || i === panels ? 1 : i % 2 ? 4 : 2;
    sum += weight * spanKernel(span * (i / panels - 0.5), span)[0];
  }
  return (sum * span) / (3 * panels);
}

export type FieldLike = { grid: number; bins: number[]; at: (i: number, d?: boolean) => number };

/** reconstruction.ts's Field with the span as a parameter: exact kernel sums, causal zero
 * history, one coherent period reused after the startup support. */
export function spanField(bins: number[], grid: number, span: number): FieldLike {
  const norm = spanNorm(span);
  const input = Float64Array.from(
    { length: E.frames },
    (_, n) =>
      bins.reduce((s, bin) => s + Math.sin((2 * Math.PI * bin * n) / E.frames), 0) / bins.length,
  );
  const steady = new Float64Array(2 * E.frames * grid);
  const startup = new Float64Array(2 * span * grid);
  for (let phase = 0; phase < grid; phase++) {
    const weights = Array.from({ length: span + 1 }, (_, j) =>
      spanKernel(phase / grid + j - span / 2, span),
    );
    for (let n = 0; n < E.frames; n++) {
      let h = 0,
        d = 0,
        sh = 0,
        sd = 0;
      for (let j = 0; j <= span; j++) {
        const x = input[(n - j + E.frames) % E.frames];
        const [k, kd] = weights[j];
        h += x * k;
        d += x * kd;
        if (n >= j) {
          sh += x * k;
          sd += x * kd;
        }
      }
      const index = 2 * (n * grid + phase);
      steady[index] = h / norm;
      steady[index + 1] = d / norm;
      if (n < span) [startup[index], startup[index + 1]] = [sh / norm, sd / norm];
    }
  }
  const at = (index: number, derivative = false) => {
    const offset = derivative ? 1 : 0;
    return index * 2 < startup.length
      ? startup[2 * index + offset]
      : steady[2 * (index % (E.frames * grid)) + offset];
  };
  return { grid, bins, at };
}

/** The host tone the FIR pair's interpolator receives, at the render's gain. */
export const hostTone = (signal: Signal) => (n: number) =>
  (signal.sign *
    signal.amplitude *
    signal.bins.reduce((s, bin) => s + Math.sin((2 * Math.PI * bin * n) / E.frames), 0)) /
  signal.bins.length;

/** RK4 stages read the span's continuous field (the pair's interpolating function, with its
 * exact derivative); every accepted state then feeds the imported decimator in place of
 * its core, so output[n] = Σ taps[j] · M[n·factor − j], delayed by `span` host samples.
 * `interpolation` is the largest |interpolator output − field| at the step points. */
// eslint-disable-next-line max-lines-per-function -- One trajectory, its abort boundary and the pair that observes it.
export function renderCandidate(o: {
  setting: Setting;
  signal: Signal;
  field: FieldLike;
  controls: number[];
  table?: Corner;
}) {
  const { setting, signal, field, controls, table = CORNER } = o;
  const { factor, span } = setting,
    rate = table.rate;
  if (
    field.grid !== 2 * factor ||
    field.bins.join() !== signal.bins.join() ||
    ![-1, 1].includes(signal.sign) ||
    !(signal.amplitude >= 0)
  )
    throw Error('Invalid candidate inputs');
  const plan = windowPlan(signal),
    frames = E.frames * plan.periods,
    states = new Float64Array(frames * factor),
    gain = signal.sign * signal.amplitude;
  let fieldPeak = 0,
    conditionedPeak = 0,
    conditionedStages = 0;
  const run = integrate({
    rate,
    factor,
    solver: table.solver,
    policy: table.policy,
    steps: states.length,
    changes: [{ step: 0, controls }],
    source: (index, out) => {
      out[0] = gain * field.at(index);
      out[1] = gain * rate * field.at(index, true);
    },
    hooks: {
      state: (i, m) => (states[i] = m),
      stage: (h, conditioned) => {
        fieldPeak = Math.max(fieldPeak, Math.abs(h));
        conditionedPeak = Math.max(conditionedPeak, Math.abs(conditioned));
        if (Math.abs(h) > K.knee) conditionedStages++;
      },
    },
  });
  if (run.failure) states.fill(NaN, run.failureIndex ?? 0);
  const Dsp =
    setting.decimator === 'symmetric' ? SymmetricResampledHysteresis : ResampledHysteresis;
  const dsp = new Dsp({ rate, factor, span, solver: table.solver });
  let k = 0,
    interpolation = 0;
  dsp.core.tick = (up: number) => {
    interpolation = Math.max(interpolation, Math.abs(up - gain * field.at(2 * k)));
    return states[k++];
  };
  const tone = hostTone(signal);
  const output = Float64Array.from({ length: frames }, (_, n) => dsp.tick(tone(n)));
  return {
    raw: Float64Array.from({ length: frames }, (_, n) => states[n * factor]),
    output,
    plan,
    fieldPeak,
    conditionedPeak,
    conditionedStages,
    failure: run.failure,
    failureIndex: run.failureIndex,
    finite: states.every(Number.isFinite) && output.every(Number.isFinite),
    final: run.final,
    resets: run.resets + dsp.core.resets,
    clips: run.clips + dsp.core.clips,
    interpolation,
    latency: dsp.latency,
    taps: dsp.taps.length,
    decimator: dsp instanceof SymmetricResampledHysteresis ? 'symmetric' : 'existing',
  };
}
