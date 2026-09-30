/** Evidence for windsor#192: ruler, anchor, errors, gate, orders, attribution
 * and outcome. Only `errors` runs in the numerical child; assembly reads saved
 * records and computes no trajectory.
 */
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { valid } from '../2026-09-30-tape-boundary-reference/evidence.mjs';
const { EVENTS: E, cases } = await loadSource(
  `export * from './docs/research/2026-09-30-tape-event-alignment/eventConstants.ts';`,
);
const gated = ['raw', 'output'];
const keys = [...gated, 'fixed'];
const one = (found) => (found.length === 1 ? found[0] : null);
const find = (trials, { id, factor, method }) =>
  one(trials.filter((t) => t.id === id && t.factor === factor && t.method === method));

/** #188's saved 8192x row of one case, read only. */
export const rulerRow = (saved, id, table = E) =>
  one(saved.trials.filter((t) => t.id === id && t.factor === table.ruler.factor));

/** The ruler holds: pinned file hash, recorded final M and valid samples per case. */
export function ruler(saved, sha256, table = E) {
  const rows = cases(table).map((row) => {
    const t = rulerRow(saved, row.id, table);
    const final = t?.state.final ?? null;
    const matches = !!t && valid(t, table) && final === Math.sign(row.level) * table.ruler.final;
    return { id: row.id, final, matches };
  });
  return { sha256, matches: sha256 === table.ruler.sha256 && rows.every((r) => r.matches), rows };
}

/** Fixed rows at the anchor factor must equal #188's saved rows: all samples and final M. */
export function anchor(trials, saved, table = E) {
  const { factor, final } = table.anchor;
  const checks = cases(table).map((row) => {
    const t = find(trials, { id: row.id, factor, method: 'fixed' });
    const old = one(saved.trials.filter((s) => s.id === row.id && s.factor === factor));
    const matches =
      !!t &&
      !!old &&
      t.state.final === Math.sign(row.level) * final &&
      t.state.final === old.state.final &&
      keys.every((key) => JSON.stringify(t.samples[key]) === JSON.stringify(old.samples[key]));
    return { id: row.id, factor, matches };
  });
  return {
    source: 'windsor#188 measurement.json',
    checks,
    matches: checks.every((c) => c.matches),
  };
}

/** Maximum, its first frame and the probe-frame error against the ruler, per observation. */
export function errors(t, reference, table = E) {
  if (!valid(t, table) || !valid(reference, table)) return null;
  const at = (key, i) => Math.abs(t.samples[key][i] - reference.samples[key][i]);
  return Object.fromEntries(
    keys.map((key) => {
      let frame = 0;
      for (let i = 1; i < table.frames; i++) if (at(key, i) > at(key, frame)) frame = i;
      return [key, { max: at(key, frame), frame, probe: at(key, table.probeFrame) }];
    }),
  );
}

/** Unaligned state switches at a maximum: in #188's step n*F, and in the host
 * frame before the sample, steps [(n-1)F, nF). Evidence only, not a cause. */
export function attribution(t, table = E) {
  if (!t?.errors) return null;
  const d = t.diagnostics;
  const tally = (lo, hi) =>
    Object.fromEntries(
      table.switches.map((k) => [
        k,
        d.records[k].filter((r) => r.step >= lo && r.step < hi).length,
      ]),
    );
  return Object.fromEntries(
    gated.map((key) => {
      const { frame } = t.errors[key],
        step = frame * t.factor;
      const atStep = tally(step, step + 1),
        precedingFrame = tally(step - t.factor, step);
      const any = table.switches.some((k) => atStep[k] + precedingFrame[k] > 0);
      const truncated = table.switches.some((k) => d.truncated[k] > 0);
      return [key, { frame, step, atStep, precedingFrame, atSwitch: truncated ? null : any }];
    }),
  );
}

const passes = (t, table) =>
  valid(t, table) &&
  !!t.errors &&
  gated.every((k) => Number.isFinite(t.errors[k]?.max) && t.errors[k].max <= table.tolerance);

/** F qualifies only if F and 2F both pass raw and full for both cases in a
 * complete run with a held anchor and ruler. Fixed-8x is never gated. */
export function gate(report, method, table = E) {
  const usable =
    report.run.status === 'complete' &&
    report.anchor?.matches === true &&
    report.ruler?.matches === true;
  const passing = (factor) =>
    cases(table).every((row) => passes(find(report.trials, { id: row.id, factor, method }), table));
  const qualifying = table.levels.filter(
    (f) => usable && table.levels.includes(2 * f) && passing(f) && passing(2 * f),
  );
  return {
    method,
    passingFactors: table.levels.filter(passing),
    qualifying,
    cheapest: qualifying[0] ?? null,
  };
}

/** Observed order log2(e_F / e_2F) for consecutive factors, per case and observation. */
export function orders(report, method, table = E) {
  return cases(table).flatMap((row) =>
    table.levels.slice(1).map((to, i) => {
      const [a, b] = [table.levels[i], to].map((factor) =>
        find(report.trials, { id: row.id, factor, method }),
      );
      const order = (k) =>
        a?.errors && b?.errors ? Math.log2(a.errors[k].max / b.errors[k].max) : null;
      return { id: row.id, from: table.levels[i], to, raw: order('raw'), output: order('output') };
    }),
  );
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
function worst(report, method, factor, table) {
  const found = cases(table).map((row) => find(report.trials, { id: row.id, factor, method }));
  if (!found.every((t) => t?.errors)) return null;
  return Math.max(...found.flatMap((t) => gated.map((k) => t.errors[k].max)));
}

/** Exactly one of windsor#192's outcomes (a), (b) or (c), with its inputs. */
export function interpret(report, table = E) {
  const [fixed, aligned] = table.methods.map((m) => gate(report, m, table));
  const finest = table.levels.at(-1);
  const improvement =
    worst(report, 'fixed', finest, table) / worst(report, 'aligned', finest, table);
  const order = Object.fromEntries(
    table.methods.map((m) => [
      m,
      mean(
        orders(report, m, table)
          .flatMap((o) => [o.raw, o.output])
          .filter(Number.isFinite),
      ),
    ]),
  );
  const cheaper =
    aligned.cheapest !== null && (fixed.cheapest === null || aligned.cheapest < fixed.cheapest);
  const residual = cases(table).map((row) =>
    attribution(find(report.trials, { id: row.id, factor: finest, method: 'aligned' }), table),
  );
  const atSwitches = residual.every((r) => !!r && gated.every((k) => r[k].atSwitch === true));
  const material = Number.isFinite(improvement) && improvement >= table.material;
  const outcome = cheaper && order.aligned > order.fixed ? 'a' : material && atSwitches ? 'b' : 'c';
  return { outcome, gates: { fixed, aligned }, order, improvement, material, atSwitches, residual };
}

/** Event counts per factor and case, beside #190's stage-transition counts. */
export function eventCounts(events, table = E) {
  return events.map(({ id, factor, counts, merged, atNode, inserted }) => ({
    id,
    factor,
    counts,
    merged,
    atNode,
    inserted,
    sameAsPrior: table.kinds.every((k) => counts[k] === table.priorCounts[k]),
  }));
}

function identities(table = E) {
  return table.levels.flatMap((factor) =>
    cases(table).flatMap((row) => table.methods.map((m) => `${row.id}@${factor}/${m}`)),
  );
}

export function assemble(entries, run, table = E) {
  const values = (kind) => entries.filter((e) => e.kind === kind).map((e) => e.value);
  const trials = values('trial'),
    events = values('events');
  const done = trials.map((t) => `${t.id}@${t.factor}/${t.method}`),
    expected = identities(table);
  const complete =
    done.length === expected.length &&
    new Set(done).size === done.length &&
    expected.every((id) => done.includes(id));
  const finished = !run.expired && run.exitCode === 0 && !run.truncatedTail && complete;
  const report = {
    run: {
      ...run,
      status: finished ? 'complete' : 'incomplete',
      scheduledTrajectories: expected.length,
      completedTrajectories: trials.length,
    },
    ruler: values('ruler')[0] ?? null,
    anchor: values('anchor')[0] ?? null,
    missing: expected.filter((id) => !done.includes(id)),
    eventCounts: eventCounts(events, table),
  };
  const orderRows = Object.fromEntries(
    table.methods.map((m) => [m, orders({ ...report, trials }, m, table)]),
  );
  return {
    ...report,
    outcome: interpret({ ...report, trials }, table),
    orders: orderRows,
    events,
    trials,
  };
}
