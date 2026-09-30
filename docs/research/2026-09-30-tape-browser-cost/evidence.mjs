/** windsor#211 evidence: per-cell statistics, the real-time counters, the target
 * assessment, the phase-2 multiples and the one-path/two-path statement, all recomputed
 * from saved raw records. No timing happens here.
 */
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
const { COST, CONFIGURATIONS, plan } = await loadSource(
  `export * from './docs/research/2026-09-30-tape-browser-cost/costConstants.ts';`,
);
export { COST, CONFIGURATIONS, plan };
const MEAN_STATES = ['mean within target', 'mean outside target', 'not measured'];
export { MEAN_STATES };

export const quantumMs = (table = COST) => (table.quantumFrames / table.rate) * 1000;
export const withinTarget = (ms, table = COST) => ms <= table.targetMs;
const sorted = (xs) => [...xs].sort((a, b) => a - b);
/** The middle of an odd count; declared repeats are odd. */
export const median = (xs) => sorted(xs)[Math.floor(xs.length / 2)];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const four = (table) => Math.max(...table.instances);
const context = (options = {}) => {
  const table = options.table ?? COST,
    configurations = options.configurations ?? CONFIGURATIONS;
  return { table, configurations, steps: options.steps ?? plan(table, configurations) };
};

/** Offline cells: repeats, median/min/max render time, duty and ms per quantum.
 * A cell with fewer than the declared repeats is kept but not measured. */
export function offlineCells(repeats, options) {
  const { table, steps } = context(options),
    audioMs = table.program.seconds * 1000,
    q = quantumMs(table);
  return steps
    .filter((s) => s.kind === 'offline')
    .map((s) => {
      const rows = repeats.filter((r) => r.step === s.id),
        renderMs = rows.map((r) => r.renderMs);
      const stats = renderMs.length
        ? { medianMs: median(renderMs), minMs: Math.min(...renderMs), maxMs: Math.max(...renderMs) }
        : { medianMs: null, minMs: null, maxMs: null };
      const per = (ms) => (ms === null ? null : (ms / audioMs) * q);
      return {
        ...s,
        repeats: renderMs.length,
        renderMs,
        ...stats,
        duty: stats.medianMs === null ? null : stats.medianMs / audioMs,
        msPerQuantum: per(stats.medianMs),
        msPerQuantumMin: per(stats.minMs),
        msPerQuantumMax: per(stats.maxMs),
        resets: sum(rows.flatMap((r) => r.reports.map((p) => p.resets))),
        nonfinite: sum(rows.map((r) => r.outputNonfinite)),
        measured: renderMs.length >= table.repeats,
      };
    });
}

/** The batched counter: per-batch wall and summed-busy ms per quantum, four nodes. */
function batched(reports, table) {
  const n = table.realtime.batchQuanta,
    batches = Math.min(...reports.map((r) => r.batches.wallMs.length));
  const wall = reports.flatMap((r) => r.batches.wallMs.slice(0, batches).map((ms) => ms / n));
  const busy = Array.from(
    { length: batches },
    (_, i) => sum(reports.map((r) => r.batches.busyMs[i])) / n,
  );
  const stat = (xs) =>
    xs.length ? { mean: sum(xs) / xs.length, max: Math.max(...xs) } : { mean: null, max: null };
  return {
    batches,
    resolutionMs: 1 / n,
    wallMsPerQuantum: stat(wall),
    busyMsPerQuantum: stat(busy),
  };
}

function capacity(rc) {
  if (!rc?.available) return { available: false, updates: 0 };
  const u = rc.updates;
  const max = (k) => (u.length ? Math.max(...u.map((x) => x[k])) : null);
  return {
    available: true,
    updates: u.length,
    averageLoad: u.length ? sum(u.map((x) => x.averageLoad)) / u.length : null,
    peakLoad: max('peakLoad'),
    underrunRatio: max('underrunRatio'),
    seconds: u.length * rc.intervalSeconds,
  };
}

/** Real-time trials: phase 3's boundary counters, the batched counter, renderCapacity. */
export function realtimeRows(trials, options) {
  const { table, steps } = context(options);
  return steps
    .filter((s) => s.kind === 'realtime')
    .map((s) => {
      const t = trials.find((x) => x.step === s.id);
      if (!t || t.reports?.length !== s.instances) return { ...s, measured: false };
      const r = t.reports;
      return {
        ...s,
        measured: true,
        baseLatency: t.baseLatency,
        boundary: {
          estimatedLoadPct:
            (sum(r.map((x) => x.busyMs)) / Math.max(...r.map((x) => x.wallMs))) * 100,
          peakMs: Math.max(...r.map((x) => x.peakMs)),
          provableDeadlineMisses: sum(r.map((x) => x.underruns)),
        },
        batched: batched(r, table),
        renderCapacity: capacity(t.renderCapacity),
        resets: sum(r.map((x) => x.resets)),
        nonfinite: sum(r.map((x) => x.nonfinite)),
      };
    });
}

const fourCell = (cells, id, mode, table) =>
  cells.find(
    (c) => c.configuration === id && c.instances === four(table) && c.mode === mode && c.measured,
  ) ?? null;

/** Decision 6, mean: both four-instance offline medians at or under the target. */
export function assessMean(cells, id, table = COST) {
  const pair = table.modes.map((m) => fourCell(cells, id, m, table));
  if (pair.some((c) => !c)) return 'not measured';
  return pair.every((c) => withinTarget(c.msPerQuantum, table))
    ? 'mean within target'
    : 'mean outside target';
}

/** Decision 6, peak: unresolved unless renderCapacity showed no underrun and
 * peakLoad under the limit in both four-instance trials. */
export function assessPeak(rows, id, table = COST) {
  const pair = table.modes.map((m) => rows.find((r) => r.configuration === id && r.mode === m));
  const reason = pair.some((r) => !r?.measured)
    ? 'real-time trial not measured'
    : pair.some((r) => !r.renderCapacity.available)
      ? 'renderCapacity absent'
      : pair.some((r) => r.renderCapacity.updates === 0)
        ? 'renderCapacity reported no update'
        : pair.some((r) => r.renderCapacity.underrunRatio > 0)
          ? 'renderCapacity reported underruns'
          : pair.some((r) => r.renderCapacity.peakLoad >= table.peakLoadLimit)
            ? `peakLoad reached ${table.peakLoadLimit}`
            : null;
  if (reason) return { state: 'unresolved', reason };
  const seconds = Math.min(...pair.map((r) => r.renderCapacity.seconds));
  return {
    state: 'resolved',
    reason: `no underrun and peakLoad < ${table.peakLoadLimit} for ${seconds} s in each trial`,
    seconds,
  };
}

export function assessments(cells, rows, options) {
  const { table, configurations } = context(options);
  return configurations.map((c) => ({
    id: c.id,
    role: c.role,
    mean: assessMean(cells, c.id, table),
    peak: assessPeak(rows, c.id, table),
  }));
}

/** Decision 7: four-instance duty over legacy's, and the filter-only share. */
export function comparison(cells, options) {
  const { table, configurations } = context(options),
    { baseline, filter, filterOf } = table.comparison;
  const ratio = (a, b, mode) => {
    const [x, y] = [a, b].map((id) => fourCell(cells, id, mode, table));
    return x && y ? x.duty / y.duty : null;
  };
  const both = (a, b) => Object.fromEntries(table.modes.map((m) => [m, ratio(a, b, m)]));
  return {
    multiples: configurations
      .filter((c) => c.id !== baseline)
      .map((c) => ({ id: c.id, role: c.role, ...both(c.id, baseline) })),
    filterShare: { filter, of: filterOf, ...both(filter, filterOf) },
  };
}

/** Decision 7's statement. It describes the numbers; it chooses nothing. */
export function paths(assessed) {
  const ids = (state) =>
    assessed.filter((a) => a.role === 'candidate' && a.mean === state).map((a) => a.id);
  const within = ids(MEAN_STATES[0]),
    unmeasured = ids(MEAN_STATES[2]),
    baseline = assessed.find((a) => a.role === 'baseline')?.mean ?? MEAN_STATES[2];
  const onePath = within.length ? 'within' : unmeasured.length ? 'undetermined' : 'outside';
  const legacy = {
    [MEAN_STATES[0]]: 'legacy is: the numbers leave room only for an inexpensive/magnetic pair.',
    [MEAN_STATES[1]]: 'nor is legacy.',
    [MEAN_STATES[2]]: 'legacy was not measured.',
  }[baseline];
  const statement =
    onePath === 'within'
      ? `One magnetic path is within target on mean (${within.join(', ')}); peak is assessed separately.`
      : onePath === 'undetermined'
        ? `No measured magnetic candidate is within target on mean; ${unmeasured.join(', ')} not measured.`
        : `No magnetic candidate is within target on mean; ${legacy}`;
  return { onePath, within, unmeasured, baseline, statement, chosen: null };
}

export function checkProgram(program, table = COST) {
  if (!program) return { measured: false, passes: false };
  const hashMatches = program.sha256 === table.program.sha256;
  return { measured: true, hashMatches, passes: hashMatches && program.passes };
}

/** Every table in the saved report, from its raw records and declared settings. */
export function tables(raw, options) {
  const ctx = context(options),
    cells = offlineCells(raw.repeats, ctx),
    realtimeTable = realtimeRows(raw.realtime, ctx),
    assessed = assessments(cells, realtimeTable, ctx);
  return {
    check: checkProgram(raw.program, ctx.table),
    cells,
    realtimeTable,
    assessments: assessed,
    comparison: comparison(cells, ctx),
    paths: paths(assessed),
  };
}

/** Report from a recovered journal: every record kept, missing work inventoried. */
export function assemble(entries, run, options) {
  const ctx = context(options),
    of = (kind) => entries.filter((e) => e.kind === kind).map((e) => e.value);
  const raw = {
    program: of('program')[0] ?? null,
    repeats: of('repeat'),
    realtime: of('realtime'),
    errors: of('error'),
  };
  const derived = tables(raw, ctx);
  const missing = {
    offline: derived.cells.filter((c) => !c.measured).map((c) => `${c.id} (${c.repeats} repeats)`),
    realtime: derived.realtimeTable.filter((r) => !r.measured).map((r) => r.id),
  };
  const scheduled = { offline: derived.cells.length, realtime: derived.realtimeTable.length };
  const completed = {
    offline: scheduled.offline - missing.offline.length,
    realtime: scheduled.realtime - missing.realtime.length,
  };
  const complete =
    of('done').length > 0 &&
    !run.expired &&
    !run.truncatedTail &&
    raw.errors.length === 0 &&
    derived.check.passes &&
    !missing.offline.length &&
    !missing.realtime.length;
  return {
    run: { ...run, status: complete ? 'complete' : 'incomplete', scheduled, completed },
    missing,
    ...derived,
    settings: { cost: ctx.table, configurations: ctx.configurations, steps: ctx.steps },
    ...raw,
  };
}
