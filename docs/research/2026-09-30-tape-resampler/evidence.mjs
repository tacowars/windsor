/** windsor#207 evidence: pass/fail on the two declared figures, method agreement,
 * medians and the outcome tables, all recomputed from saved records. No new numerics.
 */
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
const {
  RESAMPLER: R,
  filters,
  filterId,
  benchmarkGroups,
} = await loadSource(
  `export * from './docs/research/2026-09-30-tape-resampler/resamplerConstants.ts';`,
);

export const levelPasses = (db, table = R) => db <= table.levelTargetDb;
export const passbandPasses = (deviationDb, table = R) => deviationDb <= table.passbandTargetDb;
const worst = (rows, key) => Math.max(...rows.map((r) => r[key]));
const spread = (rows) => Math.max(...rows.map((r) => Math.abs(r.irDb - r.toneDb)));
export const median = (times) => [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];

/** Impulse-response versus direct-tone figures for one filter record. */
export function agreement(record, table = R) {
  const passbandDb = Math.max(
    ...['interpolator', 'cascade'].map((k) =>
      Math.abs(record.ir[k].deviationDb - record.tone[k].deviationDb),
    ),
  );
  const imageDb = spread(record.images),
    aliasDb = spread(record.aliases);
  const agrees =
    passbandDb <= table.agreement.passbandDb &&
    Math.max(imageDb, aliasDb) <= table.agreement.levelDb;
  return { passbandDb, imageDb, aliasDb, agrees };
}

/** Per-cell medians from every complete benchmark group; partial groups excluded. */
export function benchmarkCells(rounds, table = R) {
  return benchmarkGroups(table).flatMap((group) => {
    const done = rounds.filter((r) => r.group === group.id && r.round >= 0);
    if (done.length !== table.benchmark.rounds) return [];
    return group.cells.map((cell) => {
      const timesMs = done.map((r) => r.timesMs[cell.id]);
      return { group: group.id, ...cell, timesMs, medianMs: median(timesMs) };
    });
  });
}

/** Decision 7's per-filter row: figures, both verdicts, agreement and the pair's cost. */
export function filterRow(record, cells, table = R) {
  const cost = (variant) =>
    cells.find((c) => c.group.startsWith('identity/') && c.id === `${variant}/${record.id}`)
      ?.medianMs ?? null;
  const worstImageDb = worst(record.images, 'irDb'),
    worstAliasDb = worst(record.aliases, 'irDb'),
    passbandDb = record.ir.cascade.deviationDb;
  const verdict = {
    passband: passbandPasses(passbandDb, table),
    image: levelPasses(worstImageDb, table),
    alias: levelPasses(worstAliasDb, table),
  };
  return {
    id: record.id,
    factor: record.factor,
    span: record.span,
    taps: record.taps,
    passbandDb,
    interpolatorPassbandDb: record.ir.interpolator.deviationDb,
    edges: record.ir.cascade.edges,
    interpolatorEdges: record.ir.interpolator.edges,
    worstImageDb,
    worstAliasDb,
    delay: record.ir.cascade.centroid,
    delayMatches: record.ir.cascade.matches,
    coefficients: record.coefficients.symmetric && record.coefficients.unitSum,
    ...verdict,
    meetsBoth: verdict.passband && verdict.image && verdict.alias,
    agreement: agreement(record, table),
    existingMs: cost('a'),
    symmetricMs: cost('b'),
  };
}

/** Part 3 at the benchmark span: (a)/(c) is the FIR share, (c) − (d) the saving. */
export function costTable(cells, table = R) {
  return table.factors.map((factor) => {
    const at = (v) =>
      cells.find((c) => c.group === `core/${factor}x` && c.variant === v)?.medianMs ?? null;
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(at);
    const known = a !== null && c !== null && d !== null;
    return {
      factor,
      span: table.benchmark.benchmarkSpan,
      ...{ a, b, c, d },
      firShare: known ? a / c : null,
      savingMs: known ? c - d : null,
      savingFraction: known ? (c - d) / c : null,
    };
  });
}

/** Which spans meet both figures at each factor, their cost, or the shortfall. */
export function outcome(rows, table = R) {
  return table.factors.map((factor) => {
    const at = rows.filter((r) => r.factor === factor);
    const meeting = at
      .filter((r) => r.meetsBoth)
      .map(({ span, existingMs, symmetricMs }) => ({ span, existingMs, symmetricMs }));
    const best = (key) => (at.length ? Math.min(...at.map((r) => r[key])) : null);
    return {
      factor,
      measuredSpans: at.map((r) => r.span),
      meeting,
      shortfall: meeting.length
        ? null
        : {
            passbandDb: best('passbandDb'),
            worstImageDb: best('worstImageDb'),
            worstAliasDb: best('worstAliasDb'),
          },
    };
  });
}

/** The saved tables, from the saved records only. */
export function tables(report, table = R) {
  const cells = benchmarkCells(report.benchmarks, table);
  const filterTable = report.filters.map((r) => filterRow(r, cells, table));
  return {
    filterTable,
    equivalenceTable: report.equivalence.map(({ id, maxDifference, bound, location, passes }) => ({
      ...{ id, maxDifference, bound, location, passes },
    })),
    costTable: costTable(cells, table),
    outcome: outcome(filterTable, table),
  };
}

/** Report from a recovered journal: every record kept, missing work inventoried. */
export function assemble(entries, run, table = R) {
  const of = (kind) => entries.filter((e) => e.kind === kind).map((e) => e.value);
  const report = { filters: of('filter'), equivalence: of('equivalence'), benchmarks: of('round') };
  const done = benchmarkCells(report.benchmarks, table).map((c) => c.group);
  const missing = {
    filters: filters(table)
      .map(filterId)
      .filter((id) => !report.filters.some((r) => r.id === id)),
    equivalence: filters(table)
      .map(filterId)
      .filter((id) => !report.equivalence.some((r) => r.id === id)),
    benchmarks: benchmarkGroups(table)
      .map((g) => g.id)
      .filter((id) => !done.includes(id)),
  };
  const complete = Object.values(missing).every((m) => m.length === 0);
  const finished = !run.expired && run.exitCode === 0 && !run.truncatedTail && complete;
  return {
    run: { ...run, status: finished ? 'complete' : 'incomplete' },
    missing,
    ...tables(report, table),
    equivalence: report.equivalence,
    benchmarks: report.benchmarks,
    filters: report.filters,
  };
}
