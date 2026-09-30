/** Instrumented offline RK4 reference; never calls tick/reset or changes its slope.
 * Core: Jatin Chowdhury, GPL-3.0-only, 604372e4ffd9690c3e283362e4598cb43edbb475.
 * See ../2026-09-30-tape-phase-3/{COPYING,AUDIT.md,hysteresis.ts}.
 */
import { configured, stage, type pulseField } from '../2026-09-30-tape-conditioning/conditioning';
import { playback, step } from '../2026-09-30-tape-filtered-reference/filteredReference';
import { BOUNDARY as B, type BoundaryCase } from './boundaryConstants';
import { Diagnostics, equation } from './diagnostics';

export function fixedObservation(states: Float64Array, factor: number, frames: number, table = B) {
  const ratio = factor / table.observationFactor;
  if (!Number.isInteger(ratio) || ratio < 1) throw Error('Non-exact observation subgrid');
  const observed = Float64Array.from(
    { length: frames * table.observationFactor },
    (_, i) => states[i * ratio],
  );
  return playback(observed, table.observationFactor, frames);
}
// eslint-disable-next-line max-lines-per-function -- One unchanged RK4 trajectory with stage instrumentation and the original abort semantics.
export function renderBoundary(
  options: {
    row: BoundaryCase;
    factor: number;
    field: ReturnType<typeof pulseField>;
    frames?: number;
    instrument?: boolean;
  },
  table = B,
) {
  const { row, factor, field, frames = table.frames, instrument = true } = options;
  if (
    !table.levels.includes(factor) ||
    field.grid !== 2 * factor ||
    row.rate !== table.rate ||
    !Number.isInteger(frames) ||
    frames < 1 ||
    frames > table.frames
  )
    throw Error('Invalid boundary render');
  const core = configured(row.rate * factor, row.controls, table.policy);
  const slope = core.slope.bind(core),
    trace = new Diagnostics(factor, table);
  const points = new Array<number>(6),
    source = new Array<number>(6);
  const states = new Float64Array(frames * factor),
    dt = 1 / (row.rate * factor);
  let index = 0,
    call = 0,
    fieldPeak = 0,
    conditionedPeak = 0,
    conditionedStages = 0;
  let failure: string | null = null,
    failureIndex: number | null = null;
  if (instrument)
    core.slope = (m, h, velocity) => {
      const actual = slope(m, h, velocity),
        phase = table.stagePhases[call];
      const sourceIndex = call === 0 ? 0 : call === 3 ? 2 : 1;
      const terms = equation(core, { m, h, velocity });
      trace.observe({
        ...terms,
        time: (index + phase) / factor,
        step: index,
        stage: call + 1,
        sourceH: source[2 * sourceIndex],
        sourceVelocity: source[2 * sourceIndex + 1],
        m,
        h,
        velocity,
        slope: actual,
        dtSlope: dt * actual,
      });
      call++;
      return actual;
    };
  for (; index < states.length; index++) {
    states[index] = core.m;
    call = 0;
    trace.beginStep();
    try {
      for (let j = 0; j < 3; j++) {
        const h = field.at(2 * index + j),
          d = row.rate * field.at(2 * index + j, true);
        source[2 * j] = h;
        source[2 * j + 1] = d;
        const [ch, cd] = stage(h, d, table.policy);
        fieldPeak = Math.max(fieldPeak, Math.abs(h));
        conditionedPeak = Math.max(conditionedPeak, Math.abs(ch));
        if (Math.abs(h) > table.knee) conditionedStages++;
        points[2 * j] = ch;
        points[2 * j + 1] = cd;
      }
      step(core, points, dt, 'rk4');
    } catch (error) {
      failure = String(error);
      failureIndex = index;
      states.fill(NaN, index);
      break;
    }
  }
  return {
    raw: Float64Array.from({ length: frames }, (_, n) => states[n * factor]),
    output: playback(states, factor, frames),
    fixed: fixedObservation(states, factor, frames, table),
    fieldPeak,
    conditionedPeak,
    conditionedStages,
    failure,
    failureIndex,
    finite: states.every(Number.isFinite),
    final: core.m,
    resets: core.resets,
    clips: core.clips,
    diagnostics: trace.summary(failure !== null),
  };
}
