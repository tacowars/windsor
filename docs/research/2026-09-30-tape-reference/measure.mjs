/* global process, console */
/** One sequential reproduction command, writing only this directory's report. */
import { cpus, release } from 'node:os';
import { URL } from 'node:url';
import { loadSource, researchEntry } from '../2026-09-30-tape-phase-3/load.mjs';
import { writeReport } from '../2026-09-30-tape-phase-3/report.mjs';
import {
  errorDb,
  spectrumMetrics,
  powerSpectrum,
  db,
} from '../2026-09-30-tape-phase-3/spectra.mjs';
const {
  analytic,
  sampled,
  window,
  transfer,
  filterEvidence,
  boundary,
  qualifies,
  momentSlope,
  Hysteresis,
  EXPERIMENT: E,
  REFERENCE: R,
} = await loadSource(`${researchEntry}
export * from './docs/research/2026-09-30-tape-reference/reference.ts';
export * from './docs/research/2026-09-30-tape-reference/diagnostics.ts';
export { REFERENCE } from './docs/research/2026-09-30-tape-reference/referenceConstants.ts';`);
const report = {
  environment: {
    cpu: cpus()[0].model,
    os: release(),
    arch: process.arch,
    node: process.version,
    v8: process.versions.v8,
    browser: 'none',
    backend: 'Node Float64 source DSP',
  },
  settings: { ...E, ...R },
  equation: [],
  filters: [],
  references: [],
  candidates: [],
  decomposition: [],
  boundaries: [],
};
function record(render, extended = false, delay = 0) {
  return window(
    render.output,
    extended ? render.plan.extendedPeriod : render.plan.principalPeriod,
    delay,
  );
}
function evidence(render) {
  const { peak, final, resets, clips } = render;
  const primary = record(render);
  return {
    plan: render.plan,
    peak,
    final,
    resets,
    clips,
    first: primary[0],
    last: primary.at(-1),
    finite: render.output.every(Number.isFinite),
    originalSettlingDb: errorDb(window(render.output, 1), record(render)),
    extendedSettlingDb: errorDb(primary, record(render, true)),
  };
}
function refinement(id, family, renders, levels, gate) {
  const errors = renders.slice(0, -1).map((r, i) => errorDb(record(r), record(renders[i + 1])));
  const states = renders.map(evidence);
  const passes = qualifies(errors, states, gate);
  report.references.push({ ...id, family, levels, errorsDb: errors, gateDb: gate, passes, states });
  return renders.at(-1);
}
function residual(actual, reference) {
  if (actual.resets || actual.clips || reference.resets || reference.clips) return null;
  return errorDb(record(actual), record(reference));
}
function decomposition(id, signal, analyticRef, gate) {
  const options = { rate: id.rate, factor: R.diagnosticFactor, signal };
  const raw = refinement(
    id,
    'frozen-alpha-raw',
    R.subdivisions.map((subdivisions) => sampled({ ...options, subdivisions })),
    R.subdivisions,
    gate,
  );
  const filtered = refinement(
    id,
    'frozen-alpha-filtered',
    R.subdivisions.map((subdivisions) => sampled({ ...options, subdivisions, filtered: true })),
    R.subdivisions,
    gate,
  );
  for (const solver of E.solvers) {
    const candidate = sampled({ ...options, solver });
    const full = sampled({ ...options, solver, filtered: true });
    report.decomposition.push({
      ...id,
      solver,
      factor: R.diagnosticFactor,
      rawIntegrationDb: residual(candidate, raw),
      filteredIntegrationDb: residual(full, filtered),
      reconstructionDb: residual(raw, analyticRef),
      filterPathDifferenceDb: errorDb(record(full), record(candidate, false, E.firSpan)),
      // These are waveform differences, not additive dB budgets or an alias estimate.
      states: [evidence(candidate), evidence(full)],
    });
  }
}
function spectrum(output, bins) {
  if (bins.length === 1) return spectrumMetrics(output, bins[0]);
  const powers = powerSpectrum(output);
  const carriers = bins.reduce((sum, bin) => sum + powers[bin], 0);
  const other = powers.reduce(
    (sum, power, bin) => sum + (bin && !bins.includes(bin) ? power : 0),
    0,
  );
  return { otherThanCarriersDbc: db(other / carriers) }; // includes intended IMD/harmonics
}
function candidates(id, signal, analyticRef, fullRef) {
  for (const solver of E.solvers)
    for (const factor of E.factors) {
      const options = { rate: id.rate, signal, factor, solver };
      const raw = sampled(options),
        full = sampled({ ...options, filtered: true });
      const rawWindow = record(raw),
        referenceWindow = record(analyticRef);
      const fullWindow = record(full, false, factor === 1 ? E.firSpan : 0);
      const fullReferenceWindow = record(fullRef);
      const valid =
        !raw.resets &&
        !full.resets &&
        !raw.clips &&
        !full.clips &&
        !fullRef.resets &&
        !fullRef.clips;
      report.candidates.push({
        ...id,
        solver,
        factor,
        valid,
        rawVsAnalyticDb: valid ? errorDb(rawWindow, referenceWindow) : null,
        fullVs64xDb: valid ? errorDb(fullWindow, fullReferenceWindow) : null,
        rawGainPhase: signal.bins.map((bin) => transfer(rawWindow, referenceWindow, bin)),
        fullGainPhase: signal.bins.map((bin) => transfer(fullWindow, fullReferenceWindow, bin)),
        spectrum: spectrum(fullWindow, signal.bins),
        extendedFullResidualDb: valid
          ? errorDb(record(full, true, factor === 1 ? E.firSpan : 0), record(fullRef, true))
          : null,
        states: [evidence(raw), evidence(full)],
      });
    }
}
function trial(rate, signal) {
  const id = { rate, ...signal, domain: signal.amplitude <= 1 ? 'normal' : 'overload' };
  const gate =
    signal.bins.length > 1 || signal.bins[0] === E.bins.at(-1) ? R.highGateDb : R.lowMidGateDb;
  const analyticRef = refinement(
    id,
    'analytic',
    R.refinements.map((factor) => analytic({ rate, signal, factor })),
    R.refinements,
    gate,
  );
  const fullRef = refinement(
    id,
    'prototype-full',
    R.refinements.map((factor) => sampled({ rate, signal, factor, filtered: true })),
    R.refinements,
    gate,
  );
  decomposition(id, signal, analyticRef, gate);
  candidates(id, signal, analyticRef, fullRef);
}
const core = new Hysteresis(E.benchmarkRate);
for (const m of R.equationStates)
  for (const h of R.equationFields)
    for (const velocity of R.equationVelocities) {
      const actual = core.slope(m, h, velocity),
        independent = momentSlope({ m, h, velocity });
      report.equation.push({
        m,
        h,
        velocity,
        actual,
        independent,
        absoluteError: Math.abs(actual - independent),
      });
    }
for (const factor of E.factors)
  for (const bin of [...E.bins, ...R.twoToneBins]) report.filters.push(filterEvidence(factor, bin));
for (const rate of E.rates) {
  for (const bins of [...E.bins.map((b) => [b]), R.twoToneBins]) {
    for (const amplitude of [...R.normalLevels, R.overloadLevel])
      for (const sign of R.histories) trial(rate, { bins, amplitude, sign });
    console.log('Measured', rate, bins);
  }
  for (const solver of E.solvers)
    for (const factor of E.factors) report.boundaries.push(boundary(rate, solver, factor));
}
writeReport(new URL('./measurement.json', import.meta.url), report);
console.log(
  'Wrote measurement.json; failed reference gates:',
  report.references.filter((r) => !r.passes).length,
);
