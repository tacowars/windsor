/** windsor#250 evidence: part 1's (c) assertion and summaries and (e) reset rates, and
 * part 2's cost cells, target verdicts and ratios to #211, all recomputed from saved raw
 * records. #211's cell, real-time and assessment functions are imported unchanged. No
 * rendering or timing happens here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { writeReport } from '../2026-09-30-tape-phase-3/report.mjs';
import * as W from '../2026-09-30-tape-browser-cost/evidence.mjs';
const S = await loadSource(
  `export * from './docs/research/2026-10-01-tape-shipped-probe/probeConstants.ts';`,
);
export const { PROBE, SHIPPED, CONFIGURATIONS, guardCells, slewCells, plan } = S;
export const { withinTarget } = W;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const max = (xs) => (xs.length ? Math.max(...xs) : null);
const of = (entries, kind) => entries.filter((e) => e.kind === kind).map((e) => e.value);

/** The (c) assertion: zero resets in every cell. Any reset fails it and names the cell as
 * a blocker, complete or not; with no reset, a missing cell leaves it incomplete. */
export function guardAssertion(records, scheduled) {
  const blockers = records.filter((r) => r.resets !== 0).map((r) => r.id);
  const missing = scheduled - records.length;
  const state = blockers.length ? 'fails' : missing > 0 ? 'incomplete' : 'passes';
  return {
    rule: 'zero resets in every (c) cell',
    state,
    blockers,
    recorded: records.length,
    missing,
  };
}

/** Guard counts, resets and peaks over each group of (c) records. */
function summarise(records, keys) {
  const groups = new Map();
  for (const r of records) {
    const key = keys.map((k) => r[k]).join('/');
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].map(([key, rows]) => ({
    ...Object.fromEntries(keys.map((k) => [k, rows[0][k]])),
    key,
    cells: rows.length,
    guarded: rows.filter((r) => r.guards > 0).length,
    guards: sum(rows.map((r) => r.guards)),
    resets: sum(rows.map((r) => r.resets)),
    field: max(rows.map((r) => r.field)),
    peakM: max(rows.map((r) => r.peakM)),
    outputPeak: max(rows.map((r) => r.outputPeak)),
    nonfinite: sum(rows.map((r) => r.nonfinite)),
  }));
}

/** (e) per factor, rate and signal: counts and rates, reported, never gated. */
export function slewRates(records) {
  return summarise(records, ['factor', 'rate', 'signal']).map((g) => {
    const rows = records.filter((r) => `${r.factor}/${r.rate}/${r.signal}` === g.key);
    const rates = rows.map((r) => r.resets / r.seconds);
    const firsts = rows.map((r) => r.firstResetSeconds).filter((t) => t !== null);
    return {
      ...g,
      resetsPerSecondMean: sum(rates) / rates.length,
      resetsPerSecondMax: max(rates),
      modelsWithResets: rows.filter((r) => r.resets > 0).length,
      firstResetSeconds: firsts.length ? Math.min(...firsts) : null,
      gated: false,
    };
  });
}

/** Every part-1 table from the raw records. */
export function probeTables(guard, slew, probe = PROBE) {
  return {
    probeAssertion: guardAssertion(guard, guardCells(probe).length),
    probeByModel: summarise(guard, ['model', 'bias']),
    probeByRate: summarise(guard, ['factor', 'rate', 'signal']),
    probeSlewRates: slewRates(slew),
  };
}

/** Part 1's report from a recovered journal: every record kept, missing cells named. */
export function assembleProbe(entries, run, probe = PROBE) {
  const guard = of(entries, 'guard'),
    slew = of(entries, 'slew');
  const done = new Set([...guard, ...slew].map((r) => r.id));
  const scheduled = { guard: guardCells(probe).length, slew: slewCells(probe).length };
  const missing = [...guardCells(probe), ...slewCells(probe)]
    .filter((c) => !done.has(c.id))
    .map((c) => c.id);
  const complete = !run.expired && run.exitCode === 0 && !run.truncatedTail && !missing.length;
  const completed = { guard: guard.length, slew: slew.length };
  return {
    probeRun: { ...run, status: complete ? 'complete' : 'incomplete', scheduled, completed },
    probeMissing: missing,
    ...probeTables(guard, slew, probe),
    probeSettings: probe,
    probeGuard: guard,
    probeSlew: slew,
  };
}

/** #211's saved research-adapter cells, the comparison's denominators. */
export function referenceCells(table = SHIPPED) {
  const path = new URL(`../../../${table.reference.report}`, import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')).cells;
}

/** Each four-instance cell's median over #211's matching research-adapter cell. */
function ratios(cells, reference, table) {
  return cells
    .filter((c) => c.instances === Math.max(...table.instances))
    .map((c) => {
      const id = `offline/${table.reference.cells[c.configuration]}/${c.instances}/${c.mode}`;
      const ref = reference.find((r) => r.id === id);
      const ratio = c.measured && ref?.measured ? c.msPerQuantum / ref.msPerQuantum : null;
      return { id: c.id, reference: id, referenceMs: ref?.msPerQuantum ?? null, ratio };
    });
}

/** Each cell's verdict: four-instance medians against the target; one instance is not. */
function verdict(cell, table) {
  if (cell.instances !== Math.max(...table.instances)) return 'one instance: not assessed';
  if (!cell.measured) return 'not measured';
  return withinTarget(cell.msPerQuantum, table) ? 'within target' : 'outside target';
}

/** Every part-2 table from the raw records and the declared settings. */
export function costTables(raw, options, reference = referenceCells(options.table)) {
  const { table, configurations } = options,
    factor = Object.fromEntries(configurations.map((c) => [c.id, c.factor]));
  const cells = W.offlineCells(raw.repeats, options).map((c) => ({
    ...c,
    verdict: verdict(c, table),
  }));
  const realtimeTable = W.realtimeRows(raw.realtime, options);
  const reports = [...raw.repeats, ...raw.realtime].map((r) => ({
    config: r.step.split('/').slice(1, 3).join('/'),
    factors: r.reports.map((p) => p.factor),
  }));
  return {
    costCheck: {
      ...W.checkProgram(raw.program, table),
      factorsMatch: reports.every((r) => r.factors.every((f) => f === factor[r.config])),
    },
    costCells: cells,
    costRealtimeTable: realtimeTable,
    costAssessments: W.assessments(cells, realtimeTable, options),
    costRatios: ratios(cells, reference, table),
  };
}

/** Part 2's report from a recovered journal, as #211 assembles its own. */
export function assembleCost(entries, run, options) {
  const raw = {
    program: of(entries, 'program')[0] ?? null,
    repeats: of(entries, 'repeat'),
    realtime: of(entries, 'realtime'),
    errors: of(entries, 'error'),
  };
  const derived = costTables(raw, options);
  const missing = {
    offline: derived.costCells.filter((c) => !c.measured).map((c) => `${c.id} (${c.repeats})`),
    realtime: derived.costRealtimeTable.filter((r) => !r.measured).map((r) => r.id),
  };
  const scheduled = {
    offline: derived.costCells.length,
    realtime: derived.costRealtimeTable.length,
  };
  const completed = {
    offline: scheduled.offline - missing.offline.length,
    realtime: scheduled.realtime - missing.realtime.length,
  };
  const complete =
    of(entries, 'done').length > 0 &&
    !run.expired &&
    !run.truncatedTail &&
    !raw.errors.length &&
    derived.costCheck.passes &&
    derived.costCheck.factorsMatch &&
    !missing.offline.length &&
    !missing.realtime.length;
  return {
    costRun: { ...run, status: complete ? 'complete' : 'incomplete', scheduled, completed },
    costMissing: missing,
    ...derived,
    costSettings: options,
    costProgram: raw.program,
    costErrors: raw.errors,
    costRepeats: raw.repeats,
    costTrials: raw.realtime,
  };
}

/** One measurement.json for both parts: each run replaces its own keys, parts in order. */
export function save(path, update) {
  const current = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const merged = { ...current, ...update };
  const order = (k) => (k.startsWith('probe') ? 0 : 1);
  const keys = Object.keys(merged).sort((a, b) => order(a) - order(b));
  writeReport(path, Object.fromEntries(keys.map((k) => [k, merged[k]])));
}
