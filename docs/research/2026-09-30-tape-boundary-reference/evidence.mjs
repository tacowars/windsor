/** Derive errors in the numerical child; report assembly only uses saved results. */
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { summary } from '../2026-09-30-tape-conditioning/evidence.mjs';
const { BOUNDARY: B, cases } = await loadSource(
  `export * from './docs/research/2026-09-30-tape-boundary-reference/boundaryConstants.ts';`,
);
const keys = ['raw', 'output', 'fixed'];
export function trial(row, factor, render) {
  return {
    id: row.id,
    factor,
    solver: 'rk4',
    state: summary(render, row, 'raw'),
    summaries: Object.fromEntries(keys.map((key) => [key, summary(render, row, key)])),
    samples: Object.fromEntries(
      keys.map((key) => [key, Array.from(render[key], (x) => (Number.isFinite(x) ? x : null))]),
    ),
    diagnostics: render.diagnostics,
  };
}
export function valid(t, table = B) {
  return (
    !!t &&
    t.state.finite === true &&
    !t.state.failure &&
    t.state.resets === 0 &&
    t.state.clips === 0 &&
    keys.every(
      (key) => t.samples[key]?.length === table.frames && t.samples[key].every(Number.isFinite),
    )
  );
}
export function compare(a, b, table = B) {
  const errors = Object.fromEntries(
    keys.map((key) => {
      if (!valid(a, table) || !valid(b, table)) return [key, null];
      let worst = 0;
      for (let i = 0; i < table.frames; i++)
        worst = Math.max(worst, Math.abs(a.samples[key][i] - b.samples[key][i]));
      return [key, Number.isFinite(worst) ? worst : null];
    }),
  );
  return { id: b.id, from: a.factor, to: b.factor, errors };
}
function identities(table = B) {
  const rows = cases(table);
  return {
    trials: table.levels.flatMap((factor) => rows.map((row) => `${row.id}@${factor}`)),
    pairs: table.levels
      .slice(1)
      .flatMap((factor, i) => rows.map((row) => `${row.id}@${table.levels[i]}:${factor}`)),
  };
}
export function complete(trials, pairs, table = B) {
  const expected = identities(table);
  const trialIds = trials.map((t) => `${t.id}@${t.factor}`),
    pairIds = pairs.map((p) => `${p.id}@${p.from}:${p.to}`);
  return (
    trialIds.length === expected.trials.length &&
    pairIds.length === expected.pairs.length &&
    new Set(trialIds).size === trialIds.length &&
    new Set(pairIds).size === pairIds.length &&
    expected.trials.every((id) => trialIds.includes(id)) &&
    expected.pairs.every((id) => pairIds.includes(id))
  );
}
export function group(row, trials, pairs, runComplete, table = B) {
  const own = trials.filter((t) => t.id === row.id);
  const ordered = table.levels.map((factor) => {
    const found = own.filter((t) => t.factor === factor);
    return found.length === 1 ? found[0] : null;
  });
  const comparisons = table.levels.slice(1).map((factor, i) => {
    const found = pairs.filter(
      (p) => p.id === row.id && p.from === table.levels[i] && p.to === factor,
    );
    return found.length === 1 ? found[0] : null;
  });
  const pairPasses = (p) =>
    p &&
    ['raw', 'output'].every(
      (key) =>
        Number.isFinite(p.errors[key]) && p.errors[key] <= table.tolerance && p.errors[key] >= 0,
    );
  const passingTriples = table.levels
    .slice(2)
    .flatMap((_, i) =>
      ordered.slice(i, i + 3).every((t) => valid(t, table)) &&
      comparisons.slice(i, i + 2).every(pairPasses)
        ? [table.levels.slice(i, i + 3)]
        : [],
    );
  const finest = table.levels.slice(-3);
  return {
    ...row,
    comparisons,
    diagnosticPassingTriples: passingTriples,
    qualified:
      runComplete &&
      own.length === table.levels.length &&
      passingTriples.some((t) => t.join() === finest.join()),
    missingFactors: table.levels.filter((_, i) => !ordered[i]),
  };
}
export function baselineCheck(trials, pairs, baseline) {
  const checks = [];
  for (const row of cases()) {
    const old = baseline.groups.find((g) => g.id === row.id);
    for (const [i, factor] of B.levels.slice(0, 3).entries()) {
      const actual = trials.find((t) => t.id === row.id && t.factor === factor);
      checks.push({
        id: row.id,
        factor,
        matches:
          !!actual &&
          !!old &&
          ['raw', 'output'].every(
            (key) =>
              JSON.stringify(actual.summaries[key]) ===
              JSON.stringify(old.references[key].states[i]),
          ),
      });
    }
    for (const [i, factor] of B.levels.slice(1, 3).entries()) {
      const p = pairs.find((p) => p.id === row.id && p.from === B.levels[i] && p.to === factor);
      checks.push({
        id: row.id,
        from: B.levels[i],
        to: factor,
        matches:
          !!p &&
          !!old &&
          ['raw', 'output'].every((key) => p.errors[key] === old.references[key].errors[i]),
      });
    }
  }
  return { checks, matches: checks.every((c) => c.matches) };
}
export function assemble(entries, run, table = B) {
  const trials = entries.filter((e) => e.kind === 'trial').map((e) => e.value);
  const pairs = entries.filter((e) => e.kind === 'pair').map((e) => e.value);
  const integrity = entries.find((e) => e.kind === 'baseline')?.value ?? null;
  const finished =
    !run.expired &&
    run.exitCode === 0 &&
    !run.truncatedTail &&
    complete(trials, pairs, table) &&
    integrity?.matches === true;
  const expected = identities(table),
    done = new Set(trials.map((t) => `${t.id}@${t.factor}`));
  return {
    run: {
      ...run,
      status: finished ? 'complete' : 'incomplete',
      requestedTrajectories: expected.trials.length,
      completedTrajectories: trials.length,
      requestedComparisons: expected.pairs.length,
      completedComparisons: pairs.length,
    },
    baseline: integrity,
    trials,
    pairs,
    groups: cases(table).map((row) => group(row, trials, pairs, finished, table)),
    missing: expected.trials.filter((id) => !done.has(id)),
    missingComparisons: expected.pairs.filter(
      (id) => !pairs.some((p) => `${p.id}@${p.from}:${p.to}` === id),
    ),
  };
}
