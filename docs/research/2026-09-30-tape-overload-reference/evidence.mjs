/** Additions for windsor#188 only. #183's trial/compare/group/assemble are
 * reused unchanged with OVERLOAD; its baselineCheck is bound to #178's own
 * table and #169 baseline, so the 1024x anchor against #183 lives here.
 */
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { valid } from '../2026-09-30-tape-boundary-reference/evidence.mjs';
const { OVERLOAD: O, cases } = await loadSource(
  `export * from './docs/research/2026-09-30-tape-overload-reference/overloadConstants.ts';`,
);
const gated = ['raw', 'output'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Host frame of each maximum. A sample at frame n is the state entering
 * stage 1 of step n*factor; full output at n is the playback whose newest
 * state is that same step. First maximum wins; invalid pairs have none.
 */
export function located(a, b, table = O) {
  return Object.fromEntries(
    gated.map((key) => {
      if (!valid(a, table) || !valid(b, table)) return [key, null];
      const error = (i) => Math.abs(a.samples[key][i] - b.samples[key][i]);
      let frame = 0;
      for (let i = 1; i < table.frames; i++) if (error(i) > error(frame)) frame = i;
      return [key, { frame, fromStep: frame * a.factor, toStep: frame * b.factor, stage: 1 }];
    }),
  );
}

/** Exact equality with #183's saved rows at the anchor factor: summaries,
 * all 512 samples of each observation, and the complete stage diagnostics.
 */
export function anchorCheck(trials, saved, table = O) {
  const { factor, final } = table.anchor;
  const checks = cases(table).map((row) => {
    const actual = trials.filter((t) => t.id === row.id && t.factor === factor);
    const old = saved.trials.filter((t) => t.id === row.id && t.factor === factor);
    return {
      id: row.id,
      factor,
      matches:
        actual.length === 1 &&
        old.length === 1 &&
        actual[0].state.final === Math.sign(row.level) * final &&
        ['state', 'summaries', 'samples', 'diagnostics'].every((key) =>
          same(actual[0][key], old[0][key]),
        ),
    };
  });
  return {
    source: 'windsor#183 measurement.json',
    checks,
    matches: checks.every((c) => c.matches),
  };
}

const passes = (p, table) =>
  !!p && gated.every((key) => Number.isFinite(p.errors[key]) && p.errors[key] <= table.tolerance);

/** Separate a finite precision miss from a state failure, missing work, or a
 * run whose finest pairs pass but which cannot qualify (expired, failed anchor).
 */
export function verdict(group, report, table = O) {
  const own = table.levels.map((factor) =>
    report.trials.filter((t) => t.id === group.id && t.factor === factor),
  );
  if (group.qualified) return 'qualified';
  if (own.some((found) => found.some((t) => !valid(t, table)))) return 'state failure';
  if (own.some((found) => found.length !== 1) || group.comparisons.some((p) => !p))
    return 'incomplete';
  return group.comparisons.slice(-2).every((p) => passes(p, table))
    ? 'unqualified run'
    : 'precision miss';
}

/** Exactly one of windsor#188's three outcomes, plus every passing pair. */
export function interpret(report, table = O) {
  const rows = report.groups.map((g) => ({
    id: g.id,
    verdict: verdict(g, report, table),
    passingPairs: g.comparisons.filter((p) => passes(p, table)).map((p) => [p.from, p.to]),
    finest: g.comparisons.at(-1)?.errors ?? null,
  }));
  const count = rows.filter((r) => r.verdict === 'qualified').length;
  return {
    outcome: ['neither qualified', 'one qualified', 'both qualified'][count],
    unqualified: rows.filter((r) => r.verdict !== 'qualified').map((r) => r.id),
    cases: rows,
  };
}
