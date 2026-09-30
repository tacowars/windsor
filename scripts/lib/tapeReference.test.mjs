/** Independent checks and negative controls for the #147 reference, CI-discovered. */
import { describe, it, expect } from 'vitest';
import { Hysteresis } from '../../docs/research/2026-09-30-tape-phase-3/hysteresis.ts';
import { errorDb, spectrumMetrics } from '../../docs/research/2026-09-30-tape-phase-3/spectra.mjs';
import {
  analytic,
  rkStep,
  FrozenCore,
  momentSlope,
} from '../../docs/research/2026-09-30-tape-reference/reference.ts';
import {
  sampled,
  window,
  transfer,
  filterEvidence,
  boundary,
  qualifies,
} from '../../docs/research/2026-09-30-tape-reference/diagnostics.ts';
import {
  CORE as C,
  EXPERIMENT as E,
  REFERENCE as R,
} from '../../docs/research/2026-09-30-tape-reference/referenceConstants.ts';
const rate = E.benchmarkRate;
const tone = (bin, amplitude = 1, sign = 1) => ({ bins: [bin], amplitude, sign });

describe('Tape reference equation: independent integral moments', () => {
  const core = new Hysteresis(rate);
  const fixtures = R.equationStates.flatMap((m) =>
    R.equationFields.flatMap((h) => R.equationVelocities.map((d) => [m, h, d])),
  );
  const agrees = (slope) =>
    fixtures.every(
      ([m, h, d]) =>
        Math.abs(slope(m, h, d) - momentSlope({ m, h, velocity: d })) < R.equationTolerance,
    );
  it('agrees for both directions, inactive/active irreversible branches, zero and tiny Q', () => {
    expect(agrees(core.slope.bind(core))).toBe(true);
    // Closed small-signal result at the origin, independently of integration.
    const b = (core.c * core.ms) / (3 * core.a);
    expect(core.slope(0, 0, 1)).toBeCloseTo(b / (1 - C.alpha * b), 13);
    expect(core.slope(0.1, 0.3, 0)).toBe(0);
  });
  it('rejects wrong-sign, omitted-irreversible and singular near-zero mutants', () => {
    expect(agrees((m, h, d) => -core.slope(m, h, d))).toBe(false);
    const reversibleOnly = (m, h, d) => {
      const q = (h + C.alpha * m) / core.a;
      const prime = Math.abs(q) < C.nearZero ? 1 / 3 : 1 + 1 / (q * q) - 1 / Math.tanh(q) ** 2;
      const b = ((core.c * core.ms) / core.a) * prime;
      return (d * b) / (1 - C.alpha * b);
    };
    expect(agrees(reversibleOnly)).toBe(false);
    expect(agrees((m, h, d) => (h === 0 && m === 0 ? NaN : core.slope(m, h, d)))).toBe(false);
  });
});
describe('Tape reference refinement and state', () => {
  it('passes both refinement margins and rejects an intentionally coarse reference', () => {
    const signal = tone(E.bins.at(-1));
    const render = (factor) => analytic({ rate, signal, factor, periods: 2 });
    const results = [1, ...R.refinements].map(render);
    const errors = results
      .slice(0, -1)
      .map((r, i) => errorDb(window(r.output, 1), window(results[i + 1].output, 1)));
    expect(errors[0]).toBeGreaterThan(R.highGateDb);
    expect(errors[1]).toBeLessThan(R.highGateDb);
    expect(errors[2]).toBeLessThan(R.highGateDb);
    expect(results.slice(1).every((r) => r.peak > 0 && !r.resets && !r.clips)).toBe(true);
  });
  it('refines the same frozen H/alpha-D history without refining its reconstruction', () => {
    const options = { rate, factor: R.diagnosticFactor, signal: tone(E.bins.at(-1)), periods: 2 };
    const references = R.subdivisions.map((subdivisions) => sampled({ ...options, subdivisions }));
    const error = errorDb(window(references[1].output), window(references[2].output));
    expect(error).toBeLessThan(R.highGateDb);
    const candidate = sampled(options);
    const continuous = analytic({ ...options, factor: R.refinements.at(-1) });
    expect(errorDb(window(candidate.output), window(references[2].output))).toBeLessThan(-65);
    expect(errorDb(window(references[2].output), window(continuous.output))).toBeGreaterThan(-50);
  }, 6_000); // Full CI exceeded the default 5 s; numerical gates above are unchanged.
  it('preserves opposite remanent histories, tiny forcing, DC and block endpoints', () => {
    const states = R.histories.map((sign) => {
      const core = new FrozenCore(rate * R.diagnosticFactor);
      for (let i = 0; i <= E.blockSize; i++)
        core.tick(sign * Math.sin((Math.PI * i) / E.blockSize));
      for (let i = 0; i < E.blockSize * R.diagnosticFactor; i++) core.tick(0);
      expect(core.resets + core.clips).toBe(0);
      const before = core.m;
      rkStep(core, [0, 0, 0, 0, 0, 0], 1 / rate);
      expect(core.m).toBe(before);
      return before;
    });
    expect(states[0]).toBeCloseTo(-states[1], 12);
    expect(Math.abs(states[0])).toBeGreaterThan(0.01);
    const zero = analytic({
      rate,
      factor: R.refinements[0],
      signal: tone(E.bins[0], 0),
      periods: 1,
    });
    expect(zero.output.every((x) => x === 0)).toBe(true);
    const tiny = analytic({
      rate,
      factor: R.refinements[0],
      signal: tone(E.bins[0], 1e-12),
      periods: 1,
    });
    expect(tiny.peak).toBeGreaterThan(0);
    expect(tiny.output.every(Number.isFinite)).toBe(true);
    const dc = new Hysteresis(rate);
    dc.m = states[0];
    rkStep(dc, [1, 0, 1, 0, 1, 0], 1 / rate);
    expect(dc.m).toBe(states[0]);
    for (const solver of E.solvers)
      for (const r of E.rates) {
        const rows = boundary(r, solver, R.diagnosticFactor).rows;
        expect(rows.every((row) => row.finite && Number.isFinite(row.first + row.last))).toBe(true);
        expect(rows.at(-1).resets).toBeGreaterThan(0);
        expect(rows.at(-1).clips).toBeGreaterThan(0);
      }
  });
  it('never qualifies silence, reset recovery or an incomplete refinement', () => {
    const state = { finite: true, peak: 1, resets: 0, clips: 0, extendedSettlingDb: -100 };
    const states = [state, state, state];
    expect(qualifies([-90, -90], states, R.lowMidGateDb)).toBe(true);
    for (const change of [
      { peak: 0 },
      { resets: 1 },
      { clips: 1 },
      { finite: false },
      { extendedSettlingDb: -40 },
    ])
      expect(qualifies([-300, -300], [state, state, { ...state, ...change }], R.lowMidGateDb)).toBe(
        false,
      );
    expect(qualifies([-90], states, R.lowMidGateDb)).toBe(false);
  });
  it('fails loudly on discontinuities outside the reference domain and invalid states', () => {
    const core = new FrozenCore(rate);
    for (const x of [Infinity, -Infinity, 100, -100]) expect(() => core.tick(x)).toThrow();
    for (const m of [-1e100, 1e100]) {
      core.m = m;
      expect(() => rkStep(core, [0, 0, 0, 0, 0, 0], 1 / rate)).toThrow();
    }
  });
});
describe('Tape measurements: unfitted alignment, spectra and settling', () => {
  it('measures delay and gain independently and rejects shifted or gain-fitted residuals', () => {
    const bin = E.bins[1],
      length = E.frames * 2;
    const input = Float64Array.from({ length }, (_, i) =>
      Math.sin((2 * Math.PI * bin * i) / E.frames),
    );
    const delayed = Float64Array.from(
      input,
      (_, i) => 0.5 * Math.sin((2 * Math.PI * bin * (i - E.firSpan)) / E.frames),
    );
    const aligned = window(input, 1, E.firSpan),
      measured = window(delayed, 1);
    expect(errorDb(measured, aligned)).toBeCloseTo(20 * Math.log10(0.5), 10);
    expect(transfer(measured, aligned, bin).gainDb).toBeCloseTo(20 * Math.log10(0.5), 10);
    expect(transfer(measured, aligned, bin).phaseRadians).toBeCloseTo(0, 10);
    expect(errorDb(measured, window(input, 1, E.firSpan - 1))).toBeGreaterThan(
      errorDb(measured, aligned),
    );
    expect(
      errorDb(
        Float64Array.from(measured, (x) => 2 * x),
        aligned,
      ),
    ).toBeLessThan(-200);
    expect(() => window(input, 0, E.firSpan)).toThrow();
    for (const factor of E.factors)
      expect(filterEvidence(factor, bin).measuredDelay).toBe(factor === 1 ? 0 : E.firSpan);
  });
  it('separates intended harmonics, a folded alias and transient leakage', () => {
    const make = (bin, fn) =>
      Float64Array.from({ length: E.frames }, (_, i) =>
        fn(Math.sin((2 * Math.PI * bin * i) / E.frames), i),
      );
    const harmonic = make(E.bins[1], (x) => x ** 3);
    expect(spectrumMetrics(harmonic, E.bins[1]).nonHarmonicDbc).toBeLessThan(-200);
    const bin = E.bins.at(-1) + 8; // 3*1369 exceeds Nyquist; folds to 4085.
    expect(
      spectrumMetrics(
        make(bin, (x) => x ** 3),
        bin,
      ).nonHarmonicDbc,
    ).toBeCloseTo(10 * Math.log10(1 / 9), 8);
    const transient = make(E.bins[0], (x, i) => x + Math.exp(-i / E.blockSize));
    expect(spectrumMetrics(transient, E.bins[0]).nonHarmonicDbc).toBeGreaterThan(-30);
  });
  it('detects the original quiet-tone settling leak and bounds the extended window', () => {
    const r = analytic({
      rate,
      factor: R.refinements[0],
      signal: tone(E.bins[0], R.normalLevels[0]),
    });
    expect(errorDb(window(r.output, 1), window(r.output, r.plan.principalPeriod))).toBeGreaterThan(
      R.settlingGateDb,
    );
    expect(
      errorDb(window(r.output, r.plan.principalPeriod), window(r.output, r.plan.extendedPeriod)),
    ).toBeLessThan(R.settlingGateDb);
  });
});
