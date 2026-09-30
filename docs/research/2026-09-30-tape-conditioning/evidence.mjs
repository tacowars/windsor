/** Separate absolute boundary criteria, relative tone gates and state validity. */
import { state, residual, gate } from '../2026-09-30-tape-filtered-reference/evidence.mjs';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
const {
  CONDITIONING: K,
  REFERENCE: R,
  FILTERED: F,
} = await loadSource(
  `export * from './docs/research/2026-09-30-tape-conditioning/conditioningConstants.ts';`,
);
export function valid(r) {
  return r.finite && !r.failure && !r.resets && !r.clips;
}
export function absolute(actual, reference, key) {
  if (!valid(actual) || !valid(reference) || actual[key].length !== reference[key].length)
    return null;
  let worst = 0;
  for (let i = 0; i < actual[key].length; i++)
    worst = Math.max(worst, Math.abs(actual[key][i] - reference[key][i]));
  return Number.isFinite(worst) ? worst : null;
}
export function summary(r, row, key) {
  const common = {
    finite: valid(r),
    failure: r.failure,
    failureIndex: r.failureIndex,
    resets: r.resets,
    clips: r.clips,
    final: r.final,
    fieldPeak: r.fieldPeak,
    conditionedPeak: r.conditionedPeak,
    conditionedStages: r.conditionedStages,
    reusedFrom: r.reusedFrom ?? null,
    firstSample: r[key][0],
    lastSample: Number.isFinite(r[key].at(-1)) ? r[key].at(-1) : null,
  };
  if (row.domain !== 'boundary') return { ...state(r, key), ...common };
  return {
    ...common,
    points: K.boundaryTimes.map((t) => ({
      t,
      value: Number.isFinite(r[key][t]) ? r[key][t] : null,
    })),
  };
}
export function difference(a, b, row, key, extended = false) {
  return row.domain === 'boundary'
    ? absolute(a, b, key)
    : residual(a, b, { key, referenceKey: key, extended });
}
export function target(row) {
  return row.bins.length > 1 || row.bins[0] === K.anchorBins.at(-1) ? R.highGateDb : R.lowMidGateDb;
}
export function qualifies(errors, states, row) {
  if (row.domain !== 'boundary') return gate(errors, states, target(row), R.settlingGateDb);
  return (
    errors.length === 2 &&
    states.length === 3 &&
    states.every(valid) &&
    errors.every((x) => x !== null && Number.isFinite(x) && x <= K.absoluteReference)
  );
}
export function refinement(renders, row, key) {
  const states = renders.map((r) => summary(r, row, key));
  const errors = renders.slice(1).map((r, i) => difference(renders[i], r, row, key));
  return {
    levels: K.refinements,
    metric: row.domain === 'boundary' ? 'maximum absolute' : 'unfitted RMS dB',
    errors,
    passes: qualifies(errors, states, row),
    states,
  };
}
export function candidate(actual, finest, row, references) {
  const raw = difference(actual, finest, row, 'raw');
  const output = difference(actual, finest, row, 'output');
  const extended =
    row.domain === 'boundary' ? null : difference(actual, finest, row, 'output', true);
  const sensitivityDb = extended === null || output === null ? null : Math.abs(extended - output);
  const threshold =
    row.domain === 'boundary' ? K.absoluteCandidate : target(row) + F.candidateMarginDb;
  const settled =
    row.domain === 'boundary' || (sensitivityDb !== null && sensitivityDb <= R.sensitivityDb);
  const state = summary(actual, row, 'output');
  return {
    raw,
    output,
    extended,
    sensitivityDb,
    threshold,
    state,
    referenceQualified: references.output.passes && references.raw.passes,
    passes:
      valid(actual) &&
      references.output.passes &&
      references.raw.passes &&
      raw !== null &&
      output !== null &&
      (row.domain !== 'boundary' || raw <= threshold) &&
      output <= threshold &&
      settled &&
      (row.domain === 'boundary' || state.peak > 0),
  };
}
export function complete(report, expected) {
  const ids = report.groups.map((r) => r.id);
  return (
    ids.length === expected.length &&
    new Set(ids).size === ids.length &&
    expected.every((row) => ids.includes(row.id)) &&
    report.groups.every(
      (g) =>
        g.references?.raw.states.length === 3 &&
        g.references?.output.states.length === 3 &&
        g.candidates?.length === K.candidates.length,
    )
  );
}
