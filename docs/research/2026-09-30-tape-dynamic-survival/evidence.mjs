/** windsor#204 evidence: the static pulses through #197's unchanged candidate render,
 * the 60-second program's segment records, and the survival map, inventory and
 * declaration assembled from saved records only.
 */
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import * as V from '../2026-09-30-tape-candidate-domain/evidence.mjs';
const { DYNAMIC: D, schedule } = await loadSource(
  `export * from './docs/research/2026-09-30-tape-dynamic-survival/dynamicConstants.ts';`,
);
export const key = (t) => `${t.part}:${t.id}@${t.solver}/${t.factor}`;
export const label = (t) => `${t.solver}/${t.factor}`;
const pair = (t) => `${t.rate}:${label(t)}`;
export const observe = V.observe;

/** Part 1: #197's instrumented renderConditioned, unchanged, plus the rate. */
export function renderStatic(source, { row, field, observer }, table = D) {
  return { ...V.renderCandidate(source, { row, field, observer }, table), rate: row.rate };
}

/** Part 2: one program record; the trace is returned beside it, never journaled. */
export function renderDynamic(source, { row, observer, reference }, table = D) {
  const { solver, factor, rate } = row;
  const r = source.runProgram({ rate, setting: { solver, factor }, observer, reference, table });
  const { part, id } = row;
  const record = { part, id, rate, solver, factor, final: r.final, segments: r.segments };
  return { record, trace: r.trace };
}

/** Survival is exactly this: finite, zero resets and clips, no state-guard failure. */
export const survives = V.survives;
export const segmentSurvives = (s) => !!s && s.reached === true && survives(s);
export const programSurvives = (t, table = D) =>
  !!t &&
  t.segments?.length === table.segments.length &&
  t.segments.every((s, i) => s.name === table.segments[i].name && segmentSurvives(s));

const unique = (trials, match) => {
  const found = trials.filter(match);
  return found.length === 1 ? found[0] : null;
};

/** One row per rate and setting: its nine points x two signs and its program. */
export function survivalMap(trials, table = D) {
  return table.rates.flatMap((rate) =>
    table.settings.map(({ solver, factor }) => {
      const mine = (t) => t.rate === rate && t.solver === solver && t.factor === factor;
      const points = table.points.map((controls) => {
        const signs = table.signs.map((sign) =>
          unique(
            trials,
            (t) =>
              mine(t) &&
              t.part === 'static' &&
              t.controls.join() === controls.join() &&
              t.level === sign * table.domain,
          ),
        );
        const survived = signs.some((t) => !t) ? null : signs.every(survives);
        const fields = ['finite', 'failure', 'failureIndex', 'failureTime', 'resets', 'clips'];
        const more = ['peakM', 'peakSlope', 'nonfiniteSlopes', 'final'];
        const pick = (t) => t && Object.fromEntries([...fields, ...more].map((k) => [k, t[k]]));
        return { controls, survives: survived, signs: signs.map(pick) };
      });
      const program = unique(trials, (t) => mine(t) && t.part === 'dynamic');
      const segments = table.segments.map(({ name }, i) => {
        const s = program?.segments?.[i];
        return { name, survives: s ? segmentSurvives(s) : null };
      });
      const flags = [...points.map((p) => p.survives), program ? programSurvives(program) : null];
      const survived = flags.includes(null) ? null : flags.every(Boolean);
      return { rate, solver, factor, survives: survived, points, segments };
    }),
  );
}

export function assemble(entries, run, table = D) {
  const trials = entries.filter((e) => e.kind === 'trial').map((e) => e.value);
  const expected = schedule(table).map(key),
    done = trials.map(key);
  const complete =
    done.length === expected.length &&
    new Set(done).size === done.length &&
    expected.every((id) => done.includes(id));
  const finished = !run.expired && run.exitCode === 0 && !run.truncatedTail && complete;
  return {
    run: {
      ...run,
      status: finished ? 'complete' : 'incomplete',
      scheduledTrajectories: expected.length,
      completedTrajectories: trials.length,
    },
    missing: expected.filter((id) => !done.includes(id)),
    survival: survivalMap(trials, table),
    trials,
  };
}

/** Where a row lost survival: the points and signs, and each program segment's failure. */
function losses(report, row, table) {
  const statics = row.points.flatMap((p) =>
    p.signs.flatMap((s, i) =>
      s && !survives(s)
        ? [{ controls: p.controls, level: table.signs[i] * table.domain, time: s.failureTime }]
        : [],
    ),
  );
  const program = report.trials.find(
    (t) => t.part === 'dynamic' && pair(t) === pair(row) && t.segments,
  );
  const reached = (program?.segments ?? []).filter((s) => s.reached);
  const segments = reached
    .filter((s) => !segmentSurvives(s))
    .map((s) => ({
      ...{ segment: s.name, time: s.failureTime, controls: s.failureControls },
      polarity: s.failureField === null ? null : Math.sign(s.failureField),
    }));
  const unreached = (program?.segments ?? []).filter((s) => !s.reached).map((s) => s.name);
  return { statics, segments, unreached };
}

/** Decision 7's facts: per rate and setting, and the declaration the rows support. */
export function interpret(report, table = D) {
  const rows = report.survival.map((row) => ({
    rate: row.rate,
    setting: label(row),
    survives: row.survives,
    ...(row.survives === false ? losses(report, row, table) : {}),
  }));
  const holds = (rate, setting) =>
    rows.find((r) => r.rate === rate && r.setting === setting)?.survives === true;
  const settings = table.settings.map(label);
  return {
    status: report.run.status,
    domain: table.domain,
    rows,
    declaration: {
      domain: table.domain,
      controls: 'closed cube [0,1]^3: corners and center static, schedule dynamic',
      pairs: rows.filter((r) => r.survives === true).map((r) => `${r.rate}:${r.setting}`),
      settingsAtEveryRate: settings.filter((s) => table.rates.every((r) => holds(r, s))),
      ratesForEverySetting: table.rates.filter((r) => settings.every((s) => holds(r, s))),
      unqualified: rows.filter((r) => r.survives === null).map((r) => `${r.rate}:${r.setting}`),
    },
  };
}
