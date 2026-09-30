/** Independent signed pulse evidence; level is the actual host-sample plateau. */
import { type Solver } from '../2026-09-30-tape-phase-3/hysteresis';
import { EXPERIMENT as E, REFERENCE as R, FILTERED as F } from './filteredConstants';
import { reconstruct } from './reconstruction';
import { render } from './filteredReference';

export function boundaryTrial(options: { rate: number; solver: Solver; level: number }) {
  const { rate, solver, level } = options;
  const factor = R.diagnosticFactor;
  const input = (n: number) => (n < E.blockSize ? 0 : n < 2 * E.blockSize ? level : 0);
  const field = {
    grid: 2 * factor,
    bins: [0],
    at: (i: number, derivative = false) => reconstruct(i / (2 * factor), input)[derivative ? 1 : 0],
  };
  const r = render({
    rate,
    factor,
    solver,
    field,
    frames: F.boundaryFrames,
    signal: { bins: [0], amplitude: 1, sign: 1 },
  });
  return {
    rate,
    solver,
    level,
    finite: r.finite,
    failure: r.failure,
    resets: r.resets,
    clips: r.clips,
    final: r.final,
    fieldPeak: r.fieldPeak,
    points: F.boundaryTimes.map((t) => ({
      t,
      field: reconstruct(t, input),
      raw: Number.isFinite(r.raw[t]) ? r.raw[t] : null,
      output: Number.isFinite(r.output[t]) ? r.output[t] : null,
    })),
  };
}
