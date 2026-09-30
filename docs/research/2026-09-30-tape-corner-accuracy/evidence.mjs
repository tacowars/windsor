/** windsor#215 evidence. #167's refinement/summary/validity and #153's residual, window
 * and spectrum run unchanged; the candidate gate adds only the declared span alignment,
 * the "no reference" status and the ungated domain-edge rows. */
import { residual, spectrum, window } from '../2026-09-30-tape-filtered-reference/evidence.mjs';
import { refinement, summary, valid } from '../2026-09-30-tape-conditioning/evidence.mjs';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
const S = await loadSource(`
export * from './docs/research/2026-09-30-tape-corner-accuracy/cornerConstants.ts';
export { transfer } from './docs/research/2026-09-30-tape-reference/diagnostics.ts';`);
export const { CORNER, cases, candidateId, settingId } = S;

const high = (row, table) => row.bins.length > 1 || row.bins[0] === table.highBin;
export const gateDb = (row, table = CORNER) =>
  row.amplitude === table.edgeLevel
    ? null
    : high(row, table)
      ? table.candidateGates.highDb
      : table.candidateGates.lowMidDb;
export const otherBinDbc = (s) => s?.nonHarmonicDbc ?? s?.otherThanCarriersDbc ?? null;
export const alignment = (setting, table = CORNER) => ({
  candidateDelay: setting.span,
  referenceDelay: table.referenceSpan,
  shift: setting.span - table.referenceSpan,
});

/** One reference case: #167's raw and full refinement, both required to qualify. */
export function reference(renders, row) {
  const [raw, output] = ['raw', 'output'].map((key) => refinement(renders, row, key));
  const finest = renders.at(-1);
  const qualified = raw.passes && output.passes;
  return { ...row, raw, output, qualified, spectrum: spectrum(window(finest), row.bins) };
}

/** Pass/fail from recorded fields alone, so a saved report can be re-derived. An
 * unqualified reference outranks the ungated edge level: neither ever passes. */
export function verdict(c, table = CORNER) {
  if (!c.referenceQualified) return 'no reference';
  if (!c.gated) return 'ungated';
  const meets =
    c.state.finite &&
    !c.state.resets &&
    !c.state.clips &&
    !c.state.failure &&
    c.state.peak > 0 &&
    c.residualDb !== null &&
    c.residualDb <= c.threshold &&
    c.sensitivityDb !== null &&
    c.sensitivityDb <= table.candidateGates.sensitivityDb;
  return meets ? 'pass' : 'fail';
}

/** One candidate render against the 64× reference of its case (the declared table). */
export function candidate(actual, finest, row, ref, setting) {
  const table = CORNER;
  const align = alignment(setting, table);
  const options = { referenceDelay: align.shift };
  const residualDb = residual(actual, finest, options);
  const extendedDb = residual(actual, finest, { ...options, extended: true });
  const state = summary(actual, row, 'output');
  const usable = residualDb !== null && valid(actual);
  const [a, b] = usable ? [window(actual), window(finest, false, align.shift)] : [];
  const otherBins = usable ? spectrum(a, row.bins) : null;
  const threshold = gateDb(row, table);
  const record = {
    id: candidateId(row, setting),
    case: row.id,
    setting: settingId(setting),
    ...setting,
    renderedDecimator: actual.decimator,
    latency: actual.latency,
    taps: actual.taps,
    alignment: align,
    interpolationDifference: actual.interpolation,
    residualDb,
    extendedDb,
    sensitivityDb:
      residualDb === null || extendedDb === null ? null : Math.abs(extendedDb - residualDb),
    gated: threshold !== null,
    threshold,
    referenceQualified: ref.qualified,
    projection: usable ? row.bins.map((bin) => ({ bin, ...S.transfer(a, b, bin) })) : null,
    otherBins,
    otherBinDbc: otherBinDbc(otherBins),
    referenceOtherBinDbc: otherBinDbc(ref.spectrum),
    state,
  };
  record.otherBinMeetsFigure =
    record.otherBinDbc === null ? null : record.otherBinDbc <= table.otherBinFigureDbc;
  record.status = verdict(record, table);
  record.passes = record.status === 'pass';
  return record;
}

/** One setting over the gated rows: passes, worst margin, failing and missing rows. */
function settingSummary(setting, gatedRows, found) {
  const rows = gatedRows.map(
    (row) => found.get(candidateId(row, setting)) ?? { case: row.id, status: 'missing' },
  );
  const failing = rows
    .filter((c) => c.status !== 'pass')
    .map((c) => ({
      case: c.case,
      status: c.status,
      residualDb: c.residualDb ?? null,
      threshold: c.threshold ?? null,
      marginDb: c.residualDb == null ? null : c.residualDb - c.threshold,
    }));
  const margins = rows
    .filter((c) => c.status !== 'missing')
    .map((c) => ({
      case: c.case,
      residualDb: c.residualDb,
      threshold: c.threshold,
      marginDb: c.residualDb === null ? Infinity : c.residualDb - c.threshold,
    }));
  const worst = margins.reduce((w, c) => (w === null || c.marginDb > w.marginDb ? c : w), null);
  return {
    setting: settingId(setting),
    gated: rows.length,
    passes: rows.filter((c) => c.status === 'pass').length,
    missing: rows.filter((c) => c.status === 'missing').length,
    worst: worst && { ...worst, marginDb: Number.isFinite(worst.marginDb) ? worst.marginDb : null },
    failing,
    meetsEverywhere: rows.every((c) => c.status === 'pass'),
  };
}

/** Per factor, every gated row whose status differs between the two spans. */
function spanComparison(gatedRows, found, table) {
  return [...new Set(table.settings.map((s) => s.factor))].map((factor) => {
    const [narrow, wide] = table.settings.filter((s) => s.factor === factor);
    const changed = gatedRows
      .map((row) => {
        const [a, b] = [narrow, wide].map((s) => found.get(candidateId(row, s)));
        return {
          case: row.id,
          [settingId(narrow)]: a?.status ?? 'missing',
          [settingId(wide)]: b?.status ?? 'missing',
          residualsDb: [a?.residualDb ?? null, b?.residualDb ?? null],
        };
      })
      .filter((r) => r[settingId(narrow)] !== r[settingId(wide)]);
    return { factor, spans: [narrow.span, wide.span], changesVerdict: changed.length > 0, changed };
  });
}

/** Decision 6: per-setting counts, the span comparison and one plain product statement. */
export function outcome(groups, table = CORNER) {
  const gatedRows = cases(table).filter((row) => gateDb(row, table) !== null);
  const found = new Map(groups.flatMap((g) => g.candidates.map((c) => [c.id, c])));
  const settings = table.settings.map((s) => settingSummary(s, gatedRows, found));
  const statement = settings
    .filter((s) => s.setting.endsWith('s'))
    .map((s) =>
      s.meetsEverywhere
        ? `${s.setting} meets the gates at all ${s.gated} gated rows.`
        : `${s.setting} passes ${s.passes}/${s.gated}; ${s.failing.length} rows fail or lack a reference or record, worst ${s.worst?.case} at ${s.worst?.marginDb?.toFixed(2)} dB past its gate.`,
    )
    .join(' ');
  return { settings, spanComparison: spanComparison(gatedRows, found, table), statement };
}

/** Rebuild the report from a (possibly truncated) journal: complete groups, partial
 * groups and every scheduled reference/candidate that never completed. */
export function assemble(entries, run, table = CORNER) {
  const expected = cases(table);
  const refs = new Map(
    entries.filter((e) => e.kind === 'reference').map((e) => [e.value.id, e.value]),
  );
  const all = entries.filter((e) => e.kind === 'candidate').map((e) => e.value);
  const done = new Set(all.map((c) => c.id));
  const groups = expected
    .filter((row) => refs.has(row.id))
    .map((row) => ({ ...refs.get(row.id), candidates: all.filter((c) => c.case === row.id) }));
  const missing = {
    references: expected.filter((row) => !refs.has(row.id)).map((row) => row.id),
    candidates: expected
      .flatMap((row) => table.settings.map((s) => candidateId(row, s)))
      .filter((id) => !done.has(id)),
  };
  const counts = {
    scheduledReferences: expected.length,
    completedReferences: refs.size,
    qualifiedReferences: groups.filter((g) => g.qualified).length,
    scheduledCandidates: expected.length * table.settings.length,
    completedCandidates: done.size,
  };
  const complete =
    !run.expired && run.exitCode === 0 && !missing.references.length && !missing.candidates.length;
  return {
    run: { ...run, status: complete ? 'complete' : 'incomplete' },
    counts,
    outcome: outcome(groups, table),
    missing,
    groups,
  };
}
