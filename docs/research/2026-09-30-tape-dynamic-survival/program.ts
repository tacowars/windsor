/** windsor#204's 60-second program: a closed-form field and its derivative in host
 * samples, the control schedule, and a stepping loop around the unchanged stage.
 * GPL-3.0-only core: Jatin Chowdhury, 604372e4ffd9690c3e283362e4598cb43edbb475.
 * See ../2026-09-30-tape-phase-3/{COPYING,AUDIT.md,hysteresis.ts}. configured, stage,
 * step and playback are imported unchanged; nothing here is product code.
 */
import { configured, stage } from '../2026-09-30-tape-conditioning/conditioning';
import type { Controls, Policy } from '../2026-09-30-tape-conditioning/conditioningConstants';
import { step, playback } from '../2026-09-30-tape-filtered-reference/filteredReference';
import { EXPERIMENT as E } from '../2026-09-30-tape-phase-3/experimentConstants';
import type { Solver } from '../2026-09-30-tape-phase-3/hysteresis';
import { mulberry32 } from '../../../packages/engine/src/sequencing/mulberry32';
import { DYNAMIC as D, type Segment } from './dynamicConstants';

type Table = typeof D;
const TAU = 2 * Math.PI;

/** Seconds to an exact host frame; a non-integer frame is a declaration error. */
export function frameAt(seconds: number, rate: number): number {
  const frame = Math.round(seconds * rate);
  if (Math.abs(frame - seconds * rate) > 1e-6) throw Error(`No exact frame at ${seconds} s`);
  return frame;
}

/** Equal tones, sum / count: every phase is reduced exactly for dyadic u. */
function tones(u: number, out: Float64Array, table: Table) {
  const n = table.period,
    r = u % n;
  let h = 0,
    d = 0;
  for (const bin of table.bins) {
    const phase = (TAU * ((bin * r) % n)) / n;
    h += Math.sin(phase);
    d += ((TAU * bin) / n) * Math.cos(phase);
  }
  out[0] = (table.domain * h) / table.bins.length;
  out[1] = (table.domain * d) / table.bins.length;
}

function levels(u: number, out: Float64Array, rate: number, index: number, table: Table) {
  const steps = (table.segments[index] as { levels: number[][] }).levels;
  const width = table.edge * rate;
  let done = -1;
  for (let k = 0; k < steps.length; k++) if (u >= steps[k][0] * rate + width) done = k;
  if (done >= 0) [out[0], out[1]] = [steps[done][1], 0];
  else evaluate(u, out, rate, index - 1, table);
  for (let k = done + 1; k < steps.length; k++) {
    const v = (u - steps[k][0] * rate) / width;
    if (v <= 0) break;
    const w = (1 - Math.cos(Math.PI * v)) / 2,
      dw = (Math.PI * Math.sin(Math.PI * v)) / (2 * width);
    const [h, d, level] = [out[0], out[1], steps[k][1]];
    out[0] = h * (1 - w) + level * w;
    out[1] = d * (1 - w) + (level - h) * dw;
  }
}

function spikes(x: number, out: Float64Array, rate: number, table: Table) {
  const every = table.spike.every * rate,
    width = table.spike.width * rate;
  const k = Math.floor(x / every),
    v = (x - k * every) / width;
  const level = (k % 2 ? -1 : 1) * table.domain;
  out[0] = v < 1 ? (level * (1 - Math.cos(TAU * v))) / 2 : 0;
  out[1] = v < 1 ? (level * Math.PI * Math.sin(TAU * v)) / width : 0;
}

/** H and dH/du of segment `index` at host-sample time u. */
function evaluate(u: number, out: Float64Array, rate: number, index: number, table: Table) {
  const s: Segment = table.segments[index];
  if (s.field === 'levels') return levels(u, out, rate, index, table);
  if (s.field === 'spikes') return spikes(u - s.start * rate, out, rate, table);
  if (s.field === 'silence') return void (out[0] = out[1] = 0);
  tones(u, out, table);
  if (!('ramp' in s) || !s.ramp) return;
  const length = (s.end - s.start) * rate,
    a = (u - s.start * rate) / length;
  out[1] = a * out[1] + out[0] / length;
  out[0] *= a;
}

/** The segment holding u: starts are inclusive, the program's end belongs to the last. */
export const segmentAt = (u: number, rate: number, table = D) =>
  table.segments.findLastIndex((s) => u >= s.start * rate);

/** The program's field at host-sample time u: out[0] = H, out[1] = dH/du. */
export function fieldAt(u: number, out: Float64Array, rate: number, table = D) {
  evaluate(u, out, rate, Math.max(0, segmentAt(u, rate, table)), table);
}

/** Seeded blocks of the nine points in shuffled order, each followed by one interior point. */
export function controlSchedule(table = D) {
  const random = mulberry32(table.schedule.seed);
  const edits = table.segments.find((s) => s.controls === 'schedule');
  if (!edits) throw Error('No scheduled segment');
  const count = Math.round((edits.end - edits.start) / table.schedule.step);
  const points: number[][] = [];
  while (points.length < count) {
    const block = table.points.map((p) => [...p]);
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [block[i], block[j]] = [block[j], block[i]];
    }
    points.push(...block, [random(), random(), random()]);
  }
  return points.slice(0, count);
}

/** Every control change of the program, in host frames, the first at frame 0. */
export function controlChanges(rate: number, table = D) {
  const scheduled = controlSchedule(table);
  return table.segments.flatMap((s) =>
    s.controls === 'schedule'
      ? scheduled.map((controls, k) => ({
          frame: frameAt(s.start, rate) + k * frameAt(table.schedule.step, rate),
          controls,
        }))
      : s.controls.map(({ at, controls }) => ({ frame: frameAt(at, rate), controls })),
  );
}

export const segmentFrames = (rate: number, table = D) =>
  table.segments.map((s) => ({
    name: s.name,
    start: frameAt(s.start, rate),
    end: frameAt(s.end, rate),
  }));

export type StageSource = (index: number, out: Float64Array) => void;
type Hooks = {
  state?: (i: number, m: number) => void;
  stage?: (h: number, conditioned: number) => void;
};
export type Integration = {
  rate: number;
  factor: number;
  solver: Solver;
  policy: Policy;
  steps: number;
  /** Writes H and dH/dt (per second) at stage index 2i + j of step i. */
  source: StageSource;
  changes: { step: number; controls: Controls }[];
  hooks?: Hooks;
};

/** renderConditioned's loop with a stage source and control changes; it aborts where
 * the imported step throws. A change reconfigures a fresh core and carries M over.
 */
export function integrate(o: Integration) {
  const { rate, factor, solver, policy, source, changes, hooks = {} } = o;
  let core = configured(rate * factor, changes[0].controls, policy),
    next = 1,
    resets = 0,
    clips = 0;
  const points = new Array<number>(6),
    out = new Float64Array(2);
  for (let i = 0; i < o.steps; i++) {
    if (next < changes.length && changes[next].step === i) {
      [resets, clips] = [resets + core.resets, clips + core.clips];
      const m = core.m;
      core = configured(rate * factor, changes[next++].controls, policy);
      core.m = m;
    }
    hooks.state?.(i, core.m);
    try {
      for (let j = 0; j < 3; j++) {
        source(2 * i + j, out);
        const [ch, cd] = stage(out[0], out[1], policy);
        hooks.stage?.(out[0], ch);
        points[2 * j] = ch;
        points[2 * j + 1] = cd;
      }
      step(core, points, 1 / (rate * factor), solver);
    } catch (error) {
      return { failure: String(error), failureIndex: i, final: core.m, resets, clips };
    }
  }
  return { failure: null, failureIndex: null, final: core.m, resets, clips };
}

/** The program as a stage source: u = index / 2factor is exact, dH/dt = rate x dH/du. */
export function programSource(rate: number, factor: number, table = D): StageSource {
  return (index, out) => {
    fieldAt(index / (2 * factor), out, rate, table);
    out[1] *= rate;
  };
}

/** playback() over one-second chunks, each led by the 32 frames its kernel reads:
 * every emitted frame sums the same taps over the same states as the whole-array call.
 */
export function streamedPlayback(
  factor: number,
  chunk: number,
  emit: (n: number, y: number) => void,
) {
  const lead = E.firSpan,
    buffer = new Float64Array((chunk + lead) * factor);
  let count = 0,
    first = 0,
    started = false;
  return (m: number) => {
    buffer[count++] = m;
    if (count < (started ? buffer.length : chunk * factor)) return;
    const frames = started ? chunk + lead : chunk,
      skip = started ? lead : 0;
    const y = playback(buffer.subarray(0, count), factor, frames);
    for (let n = skip; n < frames; n++) emit(first + n - skip, y[n]);
    first += chunk;
    buffer.copyWithin(0, count - lead * factor, count);
    [count, started] = [lead * factor, true];
  };
}

type Observer = { peaks: { slope: number; nonfinite: number }; reset: () => void };
type Trace = { raw: Float64Array; output: Float64Array };
type Kind = keyof Trace;
const tally = () => ({
  ...{ peakM: 0, peakSlope: 0, nonfiniteSlopes: 0, fieldPeak: 0, conditionedPeak: 0 },
  ...{ sum: 0, count: 0, raw: 0, output: 0, rawFinite: true, outputFinite: true },
});
type Tally = ReturnType<typeof tally>;

/** Per-segment accumulators; the trace is kept (reference) or compared (the rest). */
function recorder(rate: number, frames: number, reference: Trace | null, table: Table) {
  const bounds = segmentFrames(rate, table),
    tallies = bounds.map(tally);
  const window = frameAt(table.remanence, rate);
  const trace = reference
    ? null
    : { raw: new Float64Array(frames), output: new Float64Array(frames) };
  const sample = (kind: Kind, n: number, y: number) => {
    const t = tallies[bounds.findLastIndex((b) => n >= b.start)];
    if (trace) trace[kind][n] = y;
    const d = reference ? Math.abs(y - reference[kind][n]) : 0;
    if (!Number.isFinite(d)) t[`${kind}Finite`] = false;
    else t[kind] = Math.max(t[kind], d);
  };
  const remanence = (t: Tally, n: number, m: number, k: number) => {
    if (n < bounds[k].end - window) return;
    t.sum += m;
    t.count++;
  };
  return { bounds, tallies, window, trace, sample, remanence };
}

/** One 60-second trajectory: summaries per segment, the trace only for the reference. */
// eslint-disable-next-line max-lines-per-function -- One trajectory's hooks, abort fill and segment records share the same counters.
export function runProgram(o: {
  rate: number;
  setting: { solver: Solver; factor: number };
  observer: Observer;
  reference: Trace | null;
  table?: Table;
}) {
  const { rate, observer, reference, table = D } = o,
    { solver, factor } = o.setting;
  const frames = frameAt(table.seconds, rate),
    steps = frames * factor;
  const r = recorder(rate, frames, reference, table),
    push = streamedPlayback(factor, rate, (n, y) => r.sample('output', n, y));
  const changes = controlChanges(rate, table).map((c) => ({
    step: c.frame * factor,
    controls: c.controls,
  }));
  let k = 0;
  const close = () => {
    Object.assign(r.tallies[k], {
      peakSlope: observer.peaks.slope,
      nonfiniteSlopes: observer.peaks.nonfinite,
    });
    observer.reset();
  };
  const state = (i: number, m: number) => {
    if (k + 1 < r.bounds.length && i === r.bounds[k + 1].start * factor) {
      close();
      k++;
    }
    push(m);
    const t = r.tallies[k];
    if (Number.isFinite(m)) t.peakM = Math.max(t.peakM, Math.abs(m));
    if (i % factor) return;
    r.sample('raw', i / factor, m);
    r.remanence(t, i / factor, m, k);
  };
  const stageHook = (h: number, ch: number) => {
    const t = r.tallies[k];
    [t.fieldPeak, t.conditionedPeak] = [
      Math.max(t.fieldPeak, Math.abs(h)),
      Math.max(t.conditionedPeak, Math.abs(ch)),
    ];
  };
  observer.reset();
  const source = programSource(rate, factor, table);
  const run = integrate({
    rate,
    factor,
    solver,
    policy: table.policy,
    steps,
    source,
    changes,
    hooks: { state, stage: stageHook },
  });
  if (run.failureIndex === null)
    r.tallies[k].peakM = Math.max(r.tallies[k].peakM, Math.abs(run.final));
  close();
  for (let i = run.failureIndex ?? steps; i < steps; i++) {
    push(NaN);
    if (i % factor === 0) r.sample('raw', i / factor, NaN);
  }
  const fail = run.failureIndex;
  const field = new Float64Array(2);
  if (fail !== null) fieldAt(fail / factor, field, rate, table);
  const segments = r.bounds.map((b, j) => {
    const t = r.tallies[j],
      reached = fail === null || fail >= b.start * factor;
    const here = fail !== null && reached && fail < b.end * factor;
    return {
      ...{ name: b.name, start: b.start / rate, end: b.end / rate, reached },
      finite: reached ? !here : null,
      ...{ resets: reached ? run.resets : null, clips: reached ? run.clips : null },
      failure: here ? run.failure : null,
      failureIndex: here ? fail : null,
      failureTime: here ? fail / (rate * factor) : null,
      failureControls: here ? changes.findLast((c) => c.step <= fail)!.controls : null,
      failureField: here ? field[0] : null,
      ...{ peakM: t.peakM, peakSlope: t.peakSlope, nonfiniteSlopes: t.nonfiniteSlopes },
      ...{ fieldPeak: t.fieldPeak, conditionedPeak: t.conditionedPeak },
      remanence: t.count === r.window ? t.sum / t.count : null,
      difference: reference
        ? { raw: t.rawFinite ? t.raw : null, output: t.outputFinite ? t.output : null }
        : null,
    };
  });
  return { segments, final: run.final, failure: run.failure, trace: r.trace };
}
