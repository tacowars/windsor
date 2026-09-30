/** windsor#197 evidence: one instrumented candidate render, ruler anchors and
 * errors in the numerical child; gates, survival map and outcome from saved records.
 */
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
const {
  CANDIDATE: C,
  schedule,
  settings,
  pulses,
} = await loadSource(
  `export * from './docs/research/2026-09-30-tape-candidate-domain/candidateConstants.ts';`,
);
const gated = ['raw', 'output'];
export const key = (t) => `${t.part}:${t.id}@${t.solver}/${t.factor}`;
const label = (t) => `${t.solver}/${t.factor}`;
const sameControls = (a, b) => a.join() === b.join();

/** Observe every returned slope and accepted state without changing either.
 * The imported step calls core.slope once per stage; this.m is the accepted state.
 */
export function observe(Hysteresis) {
  const original = Hysteresis.prototype.slope;
  const peaks = { m: 0, slope: 0, nonfinite: 0 };
  Hysteresis.prototype.slope = function (m, h, velocity) {
    const value = original.call(this, m, h, velocity);
    peaks.m = Math.max(peaks.m, Math.abs(this.m));
    if (Number.isFinite(value)) peaks.slope = Math.max(peaks.slope, Math.abs(value));
    else peaks.nonfinite++;
    return value;
  };
  return {
    peaks,
    reset: () => Object.assign(peaks, { m: 0, slope: 0, nonfinite: 0 }),
    restore: () => (Hysteresis.prototype.slope = original),
  };
}

/** One unchanged renderConditioned trajectory; samples are kept for part 1 only. */
export function renderCandidate(source, { row, field, observer }, table = C) {
  observer.reset();
  const r = source.renderConditioned({
    rate: row.rate,
    factor: row.factor,
    signal: row,
    field: source.subgrid(field, row.factor),
    controls: row.controls,
    policy: row.policy,
    solver: row.solver,
    frames: table.frames,
  });
  const { part, id, controls, level, solver, factor } = row;
  const record = {
    ...{ part, id, controls, level, solver, factor },
    ...{ finite: r.finite, failure: r.failure, failureIndex: r.failureIndex },
    failureTime: r.failureIndex === null ? null : r.failureIndex / factor,
    ...{ resets: r.resets, clips: r.clips, final: r.final },
    peakM: Math.max(observer.peaks.m, Math.abs(r.final)),
    peakSlope: observer.peaks.slope,
    nonfiniteSlopes: observer.peaks.nonfinite,
    ...{ fieldPeak: r.fieldPeak, conditionedPeak: r.conditionedPeak },
  };
  if (part !== 'accuracy') return record;
  const samples = (key) => Array.from(r[key], (x) => (Number.isFinite(x) ? x : null));
  return { ...record, samples: { raw: samples('raw'), output: samples('output') } };
}

/** Survival is exactly this: finite, zero resets and clips, no state-guard failure. */
export const survives = (t) =>
  !!t && t.finite === true && !t.failure && t.resets === 0 && t.clips === 0;
const sampled = (t, table) =>
  gated.every(
    (k) => t.samples?.[k]?.length === table.frames && t.samples[k].every(Number.isFinite),
  );
export const valid = (t, table = C) => survives(t) && sampled(t, table);
/** Ruler rows are #183/#188 trials, whose validity fields live under `state`. */
export const rulerValid = (row, table = C) => survives(row?.state) && sampled(row, table);

export const rulerFor = (row, table = C) =>
  table.rulers.find(
    (r) => sameControls(r.controls, row.controls) && r.amplitude === Math.abs(row.level),
  );
export function rulerRow(report, row, ruler) {
  const found = report?.trials?.filter((t) => t.id === row.id && t.factor === ruler.factor) ?? [];
  return found.length === 1 ? found[0] : null;
}

/** Each ruler file's hash and each signed row's final M, against the declared values. */
export function anchors(read, table = C) {
  const checks = pulses(
    table.rulers.map((r) => r.controls),
    table.rulers.map((r) => r.amplitude),
    table,
  ).map((row) => {
    const ruler = rulerFor(row, table),
      { sha256, report } = read(ruler.path);
    const found = rulerRow(report, row, ruler),
      expected = Math.sign(row.level) * ruler.final;
    const final = found?.state?.final ?? null;
    const matches = sha256 === ruler.sha256 && rulerValid(found, table) && final === expected;
    return { id: row.id, path: ruler.path, factor: ruler.factor, sha256, final, expected, matches };
  });
  return { checks, matches: checks.every((c) => c.matches) };
}

/** Maximum absolute raw/full error over all frames and its first frame; null if invalid. */
export function accuracy(t, ruler, table = C) {
  return Object.fromEntries(
    gated.map((k) => {
      if (!valid(t, table) || !rulerValid(ruler, table)) return [k, null];
      let error = -1,
        frame = null;
      for (let i = 0; i < table.frames; i++) {
        const e = Math.abs(t.samples[k][i] - ruler.samples[k][i]);
        if (e > error) [error, frame] = [e, i];
      }
      return [k, Number.isFinite(error) ? { error, frame } : null];
    }),
  );
}

export function passes(t, anchor, finished, table = C) {
  return (
    finished === true &&
    anchor?.matches === true &&
    valid(t, table) &&
    gated.every((k) => Number.isFinite(t.errors?.[k]?.error) && t.errors[k].error <= table.limit)
  );
}

/** Largest surviving level, the contiguous range from the lowest, and monotonicity. */
export function extent(flags, levels) {
  let contiguous = null;
  for (let i = 0; i < flags.length && flags[i] === true; i++) contiguous = levels[i];
  const loss = flags.findIndex((f) => f === false);
  return {
    largest: levels.filter((_, i) => flags[i] === true).at(-1) ?? null,
    contiguous,
    monotone: loss < 0 || flags.slice(loss).every((f) => f !== true),
    complete: flags.every((f) => f !== null),
  };
}

const unique = (trials, match) => {
  const found = trials.filter(match);
  return found.length === 1 ? found[0] : null;
};
export function survivalMap(trials, table = C) {
  const fields = (t) =>
    Object.fromEntries(
      [
        ...['finite', 'failure', 'failureIndex', 'failureTime', 'resets', 'clips'],
        ...['peakM', 'peakSlope', 'nonfiniteSlopes', 'final'],
      ].map((k) => [k, t[k]]),
    );
  return table.controls.flatMap((controls) =>
    settings(table).map(({ solver, factor }) => {
      const levels = table.levels.map((level) => {
        const signed = table.signs.map((sign) =>
          unique(
            trials,
            (t) =>
              t.part === 'survival' &&
              label(t) === `${solver}/${factor}` &&
              sameControls(t.controls, controls) &&
              t.level === sign * level,
          ),
        );
        const survived = signed.some((t) => !t) ? null : signed.every(survives);
        return { level, survives: survived, signs: signed.map((t) => t && fields(t)) };
      });
      const flags = levels.map((l) => l.survives);
      return { controls, solver, factor, ...extent(flags, table.levels), levels };
    }),
  );
}

export function assemble(entries, run, table = C) {
  const trials = entries.filter((e) => e.kind === 'trial').map((e) => e.value);
  const anchor = entries.find((e) => e.kind === 'anchor')?.value ?? null;
  const expected = schedule(table).map(key),
    done = trials.map(key);
  const complete =
    done.length === expected.length &&
    new Set(done).size === done.length &&
    expected.every((id) => done.includes(id));
  const finished = !run.expired && run.exitCode === 0 && !run.truncatedTail && complete;
  const scheduled = schedule(table).filter((row) => row.part === 'accuracy');
  const accuracyRows = scheduled.map((row) => {
    const t = unique(trials, (x) => key(x) === key(row));
    const check = anchor?.checks.find((c) => c.id === row.id);
    const { id, level, solver, factor } = row;
    return {
      ...{ id, level, solver, factor, present: !!t, survives: survives(t) },
      errors: t?.errors ?? null,
      passes: passes(t, check, finished, table),
    };
  });
  return {
    run: {
      ...run,
      status: finished ? 'complete' : 'incomplete',
      scheduledTrajectories: expected.length,
      completedTrajectories: trials.length,
    },
    anchor,
    missing: expected.filter((id) => !done.includes(id)),
    accuracy: accuracyRows,
    survival: survivalMap(trials, table),
    trials,
  };
}

/** Decision 7's facts, without choosing a solver, default or domain. */
export function interpret(report, table = C) {
  const cases = [...new Set(report.accuracy.map((a) => a.id))].map((id) => ({
    id,
    passing: report.accuracy.filter((a) => a.id === id && a.passes).map(label),
  }));
  const survival = table.controls.map((controls) => {
    const rows = report.survival.filter((s) => sameControls(s.controls, controls));
    const reach = rows.map((s) => s.contiguous);
    return {
      controls,
      everySettingSurvivesTo: reach.includes(null) ? null : Math.min(...reach),
      survivingAtTop: rows.filter((s) => s.levels.at(-1).survives === true).map(label),
      nonMonotone: rows.filter((s) => !s.monotone).map(label),
    };
  });
  return { cases, anyAccurate: cases.some((c) => c.passing.length > 0), survival };
}
