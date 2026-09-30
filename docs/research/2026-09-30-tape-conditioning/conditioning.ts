/** Static experimental wrapper; equation imported unchanged from the GPL core.
 * Jatin Chowdhury, 604372e4ffd9690c3e283362e4598cb43edbb475, GPL-3.0-only.
 * See ../2026-09-30-tape-phase-3/{COPYING,AUDIT.md,hysteresis.ts}.
 * Never calls tick/reset: the imported RK stage integrator aborts invalid states.
 */
import { Hysteresis, type Solver } from '../2026-09-30-tape-phase-3/hysteresis';
import { step, playback } from '../2026-09-30-tape-filtered-reference/filteredReference';
import { windowPlan, type Signal } from '../2026-09-30-tape-reference/reference';
import { reconstruct } from '../2026-09-30-tape-filtered-reference/reconstruction';
import {
  CONDITIONING as K,
  CORE as C,
  EXPERIMENT as E,
  type Controls,
  type Policy,
} from './conditioningConstants';

export function configured(rate: number, controls: Controls, policy: Policy) {
  if (!K.policies.includes(policy) || controls.length !== 3 || !controls.every(Number.isFinite))
    throw Error('Invalid policy/controls');
  const core = new Hysteresis(rate);
  core.configure(controls[0], controls[1], controls[2]);
  if (policy !== 'unchanged') core.c = Math.max(0, core.c);
  return core;
}

/** Return H and its derivative multiplier, including the identity at the knee. */
export function condition(h: number, policy: Policy): [number, number] {
  if (!Number.isFinite(h) || !K.policies.includes(policy)) throw Error('Invalid field/policy');
  if (policy !== 'knee') {
    if (Math.abs(h) > C.inputLimit) throw Error('Reconstructed field outside unclipped domain');
    return [h, 1];
  }
  if (Math.abs(h) <= K.knee) return [h, 1];
  const span = K.asymptote - K.knee;
  const z = (Math.abs(h) - K.knee) / span;
  return [Math.sign(h) * (K.knee + span * (z / (1 + z))), 1 / (1 + z) ** 2];
}

export function stage(h: number, derivative: number, policy: Policy): [number, number] {
  if (!Number.isFinite(derivative)) throw Error('Invalid derivative');
  const [field, multiplier] = condition(h, policy);
  return [field, multiplier * derivative];
}

export function pulseInput(level: number, history: number) {
  if (!Number.isFinite(level) || ![0, ...K.histories].includes(history))
    throw Error('Invalid pulse');
  return (n: number) =>
    n < K.historyEnd ? history : n >= K.pulseStart && n < K.pulseEnd ? level : 0;
}

/** Exact direct reconstruction cached on the finest stage grid; no interpolation. */
export function pulseField(level: number, history: number, factor: number) {
  const grid = 2 * factor;
  const input = pulseInput(level, history);
  const values = new Float64Array(2 * (K.boundaryFrames * grid + 1));
  for (let i = 0; i < values.length / 2; i++) values.set(reconstruct(i / grid, input), 2 * i);
  return {
    grid,
    bins: [0],
    at: (i: number, derivative = false) => values[2 * i + (derivative ? 1 : 0)],
  };
}

type Field = { grid: number; bins: number[]; at: (i: number, derivative?: boolean) => number };
export function subgrid(field: Field, factor: number): Field {
  const ratio = field.grid / (2 * factor);
  if (!Number.isInteger(ratio) || ratio < 1) throw Error('Non-exact subgrid');
  return { grid: 2 * factor, bins: field.bins, at: (i, d) => field.at(i * ratio, d) };
}

// eslint-disable-next-line max-lines-per-function -- One state trajectory, stage chain rule and explicit abort boundary.
export function renderConditioned(options: {
  rate: number;
  factor: number;
  signal: Signal;
  field: Field;
  controls: Controls;
  policy: Policy;
  solver?: Solver;
  frames?: number;
}) {
  const { rate, factor, signal, field, controls, policy, solver = 'rk4' } = options;
  if (
    !E.rates.includes(rate) ||
    !Number.isInteger(factor) ||
    factor <= 0 ||
    !Number.isFinite(signal.amplitude) ||
    signal.amplitude < 0 ||
    ![-1, 1].includes(signal.sign) ||
    field.grid !== 2 * factor ||
    field.bins.join() !== signal.bins.join() ||
    !['rk2', 'rk4'].includes(solver)
  )
    throw Error('Invalid render inputs');
  const core = configured(rate * factor, controls, policy);
  const plan = windowPlan(signal);
  const frames = options.frames ?? E.frames * plan.periods;
  if (!Number.isInteger(frames) || frames < 1) throw Error('Invalid frames');
  const states = new Float64Array(frames * factor);
  const points = new Array<number>(6);
  let fieldPeak = 0,
    conditionedPeak = 0,
    conditionedStages = 0,
    failure: string | null = null;
  let failureIndex: number | null = null;
  for (let i = 0; i < states.length; i++) {
    states[i] = core.m;
    try {
      for (let j = 0; j < 3; j++) {
        const h = signal.sign * signal.amplitude * field.at(2 * i + j);
        const d = signal.sign * signal.amplitude * rate * field.at(2 * i + j, true);
        fieldPeak = Math.max(fieldPeak, Math.abs(h));
        const [ch, cd] = stage(h, d, policy);
        if (policy === 'knee' && Math.abs(h) > K.knee) conditionedStages++;
        conditionedPeak = Math.max(conditionedPeak, Math.abs(ch));
        points[2 * j] = ch;
        points[2 * j + 1] = cd;
      }
      step(core, points, 1 / (rate * factor), solver);
    } catch (error) {
      failure = String(error);
      failureIndex = i;
      states.fill(NaN, i);
      break;
    }
  }
  const raw = Float64Array.from({ length: frames }, (_, n) => states[n * factor]);
  const output = playback(states, factor, frames);
  return {
    raw,
    output,
    plan,
    fieldPeak,
    conditionedPeak,
    conditionedStages,
    failure,
    failureIndex,
    finite: states.every(Number.isFinite),
    final: core.m,
    resets: 0,
    clips: 0,
  };
}
