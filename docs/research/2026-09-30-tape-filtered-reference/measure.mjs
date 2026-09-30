/* global process, console */
/** Sequential experiment; writes only this directory's evidence. */
import { cpus, release } from 'node:os';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { writeReport } from '../2026-09-30-tape-phase-3/report.mjs';
import { window, state, gate, residual, spectrum } from './evidence.mjs';
const {
  Field,
  render,
  analytic,
  sampled,
  transfer,
  reconstruct,
  kernel,
  NORM,
  normalization,
  boundaryTrial,
  EXPERIMENT: E,
  REFERENCE: R,
  FILTERED: F,
} = await loadSource(`
export * from './docs/research/2026-09-30-tape-filtered-reference/filteredConstants.ts';
export * from './docs/research/2026-09-30-tape-filtered-reference/boundary.ts';
export * from './docs/research/2026-09-30-tape-filtered-reference/reconstruction.ts';
export * from './docs/research/2026-09-30-tape-filtered-reference/filteredReference.ts';
export * from './docs/research/2026-09-30-tape-reference/reference.ts';
export * from './docs/research/2026-09-30-tape-reference/diagnostics.ts';`);
const prior = JSON.parse(
  readFileSync(new URL('../2026-09-30-tape-reference/measurement.json', import.meta.url)),
);
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
  settings: {
    experiment: E,
    reference: R,
    filtered: F,
    normalization: NORM,
    normalizationHalfPanels: normalization(F.normalizationPanels / 2),
  },
  references: [],
  candidates: [],
  decomposition: [],
  filters: [],
  boundaries: [],
  priorFullGates: prior.references
    .filter((r) => r.family === 'prototype-full')
    .map(({ states: _states, ...r }) => r),
};
function refinement(id, renders, key, target) {
  const states = renders.map((r) => state(r, key));
  const errors = renders
    .slice(0, -1)
    .map((r, i) => residual(r, renders[i + 1], { key, referenceKey: key }));
  const passes = gate(errors, states, target, R.settlingGateDb);
  report.references.push({
    ...id,
    family: key,
    levels: F.levels,
    errorsDb: errors,
    gateDb: target,
    passes,
    states,
  });
  return passes;
}
function compare(actual, reference, options) {
  const { id, qualified, rawQualified, solver, factor, family, target } = options;
  const fullDb = residual(actual, reference, {
    delay: family === 'alpha' && factor === 1 ? E.firSpan : 0,
  });
  const extendedDb = residual(actual, reference, {
    extended: true,
    delay: family === 'alpha' && factor === 1 ? E.firSpan : 0,
  });
  const sensitivityDb =
    fullDb === null || extendedDb === null ? null : Math.abs(fullDb - extendedDb);
  const actualWindow = window(actual, false, family === 'alpha' && factor === 1 ? E.firSpan : 0);
  const valid = fullDb !== null && !actual.failure && !actual.resets && !actual.clips;
  report.candidates.push({
    ...id,
    family,
    solver,
    factor,
    referenceQualified: qualified,
    rawReferenceQualified: family === 'consistent' ? rawQualified : null,
    rawIntegrationDb:
      family === 'consistent'
        ? residual(actual, reference, { key: 'raw', referenceKey: 'raw' })
        : null,
    fullDb,
    extendedDb,
    sensitivityDb,
    candidateTargetDb: target + F.candidateMarginDb,
    passes:
      valid &&
      qualified &&
      fullDb <= target + F.candidateMarginDb &&
      sensitivityDb <= R.sensitivityDb,
    gainPhase: valid ? id.bins.map((bin) => transfer(actualWindow, window(reference), bin)) : null,
    spectrum: valid ? spectrum(actualWindow, id.bins) : null,
    state: state(actual),
  });
}
function diagnose(id, options, finest, qualifications) {
  const continuous = analytic({ ...options, factor: F.levels.at(-1) });
  const frozenAlpha = sampled({
    ...options,
    factor: R.diagnosticFactor,
    subdivisions: R.subdivisions.at(-1),
    filtered: true,
  });
  report.decomposition.push({
    ...id,
    rawQualified: qualifications.raw,
    frozenQualified: qualifications.frozen,
    fullQualified: qualifications.full,
    reconstructionVsAnalyticDb: residual(finest, continuous, {
      key: 'raw',
      referenceDelay: E.firSpan / 2,
    }),
    playbackDifferenceDb: residual(finest, finest, {
      referenceKey: 'raw',
      referenceDelay: E.firSpan / 2,
    }),
    outputQuadrature8Vs64Db: residual(finest, finest, { key: 'frozen' }),
    frozenAlphaVsConsistentDb: residual(frozenAlpha, finest),
    // Baseline fixed-forcing integration is independently anchored by #148's frozen reference.
    alphaIntegration: E.solvers.map((solver) => ({
      solver,
      errorDb: residual(
        sampled({ ...options, factor: R.diagnosticFactor, solver, filtered: true }),
        frozenAlpha,
      ),
    })),
  });
}
function trial({ bins, rate, amplitude, sign }, fields) {
  const signal = { bins, amplitude, sign };
  const id = { rate, ...signal, domain: amplitude <= 1 ? 'normal' : 'overload' };
  const target = bins.length > 1 || bins[0] === E.bins.at(-1) ? R.highGateDb : R.lowMidGateDb;
  const options = { rate, signal };
  const references = F.levels.map((factor) =>
    render({ ...options, factor, field: fields.get(factor) }),
  );
  const fullQualified = refinement(id, references, 'output', target);
  const rawQualified = refinement(id, references, 'raw', target);
  const frozenQualified = refinement(id, references, 'frozen', target);
  const finest = references.at(-1);
  diagnose(id, options, finest, {
    raw: rawQualified,
    frozen: frozenQualified,
    full: fullQualified,
  });
  for (const factor of E.factors)
    for (const solver of E.solvers) {
      const comparison = { id, qualified: fullQualified, rawQualified, solver, factor, target };
      compare(render({ ...options, factor, solver, field: fields.get(factor) }), finest, {
        ...comparison,
        family: 'consistent',
      });
      compare(sampled({ ...options, factor, solver, filtered: true }), finest, {
        ...comparison,
        family: 'alpha',
      });
    }
}
for (const bins of [...E.bins.map((b) => [b]), R.twoToneBins]) {
  const fields = new Map(
    [...E.factors, ...F.levels].map((factor) => [factor, new Field(bins, 2 * factor)]),
  );
  for (const rate of E.rates)
    for (const amplitude of [...R.normalLevels, R.overloadLevel]) {
      for (const sign of R.histories) trial({ bins, rate, amplitude, sign }, fields);
      console.log('Measured', bins, rate, amplitude);
    }
}
for (const factor of [...E.factors, ...F.levels]) {
  const frames = E.blockSize;
  const impulseStates = Float64Array.from(
    { length: frames * factor },
    (_, i) => reconstruct(i / factor, (n) => (n === 0 ? 1 : 0))[0],
  );
  // Independent direct sampled convolution for linear-pair diagnostics.
  const impulse = Float64Array.from({ length: frames }, (_, n) => {
    let sum = 0;
    for (let j = 0; j <= Math.min(n * factor, E.firSpan * factor); j++)
      sum +=
        (kernel(j / factor - E.firSpan / 2)[0] / (NORM * factor)) * impulseStates[n * factor - j];
    return sum;
  });
  report.filters.push({
    factor,
    measuredDelay: impulse.indexOf(Math.max(...impulse)),
    dcGain: impulse.reduce((sum, x) => sum + x, 0),
    first: impulse[0],
    last: impulse.at(-1),
  });
}
for (const rate of E.rates)
  for (const solver of E.solvers)
    for (const level of F.boundaryLevels)
      report.boundaries.push(boundaryTrial({ rate, solver, level }));
writeReport(new URL('./measurement.json', import.meta.url), report);
console.log(
  'Wrote report; normal reference failures:',
  report.references.filter((r) => r.domain === 'normal' && !r.passes).length,
);
