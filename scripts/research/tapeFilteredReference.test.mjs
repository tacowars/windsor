/** Independent reconstruction, timestamps and qualification checks for Windsor #150. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { boundaryTrial } from '../../docs/research/2026-09-30-tape-filtered-reference/boundary.ts';
import {
  kernel,
  normalization,
  NORM,
  reconstruct,
  Field,
} from '../../docs/research/2026-09-30-tape-filtered-reference/reconstruction.ts';
import {
  render,
  playback,
  step,
} from '../../docs/research/2026-09-30-tape-filtered-reference/filteredReference.ts';
import {
  EXPERIMENT as E,
  CORE as C,
  REFERENCE as R,
  FILTERED as F,
} from '../../docs/research/2026-09-30-tape-filtered-reference/filteredConstants.ts';
import { coefficients } from '../../docs/research/2026-09-30-tape-phase-3/resampler.ts';
import { Hysteresis } from '../../docs/research/2026-09-30-tape-phase-3/hysteresis.ts';
import { errorDb } from '../../docs/research/2026-09-30-tape-phase-3/spectra.mjs';
import {
  gate,
  residual,
  state,
  window,
} from '../../docs/research/2026-09-30-tape-filtered-reference/evidence.mjs';

describe('Continuous reconstructed field and derivative', () => {
  it('has the analytic kernel center, support endpoints, symmetry and stable integral', () => {
    expect(kernel(0)[0]).toBeCloseTo(2 * E.cutoff, 14);
    expect(kernel(0)[1]).toBe(0);
    for (const t of [-E.firSpan, -E.firSpan / 2, E.firSpan / 2, E.firSpan])
      expect(kernel(t)).toEqual([0, 0]);
    for (const t of [1e-12, 0.01, 0.25, 1, 7, 15.5]) {
      expect(kernel(-t)[0]).toBe(kernel(t)[0]);
      expect(kernel(-t)[1]).toBe(-kernel(t)[1]);
    }
    expect(Math.abs(NORM - normalization(F.normalizationPanels / 2))).toBeLessThan(
      F.identityTolerance,
    );
  });
  it('matches the independently coded original FIR in the fine-grid limit', () => {
    const factor = F.levels.at(-1),
      taps = coefficients(factor);
    const sum = Array.from(taps, (_, i) => kernel(i / factor - E.firSpan / 2)[0]).reduce(
      (a, b) => a + b,
      0,
    );
    for (let i = 0; i < taps.length; i++)
      expect(kernel(i / factor - E.firSpan / 2)[0] / sum).toBeCloseTo(taps[i], 14);
  });
  it('differentiates actual reconstructed H at interior stages and endpoints', () => {
    const input = (n) => (n === 0 ? 1 : n === 1 ? -0.25 : 0);
    for (const t of [0, 0.125, 1, 1.5, 15.875, 16, 16.125, 31.5, 32, 33]) {
      const [h, d] = reconstruct(t, input);
      const finiteDifference =
        (reconstruct(t + F.derivativeStep, input)[0] -
          reconstruct(t - F.derivativeStep, input)[0]) /
        (2 * F.derivativeStep);
      expect(Number.isFinite(h + d)).toBe(true);
      expect(Math.abs(d - finiteDifference)).toBeLessThan(F.derivativeTolerance);
    }
    const t = 15.5,
      d = reconstruct(t, input)[1];
    const numerical =
      (reconstruct(t + F.derivativeStep, input)[0] - reconstruct(t - F.derivativeStep, input)[0]) /
      (2 * F.derivativeStep);
    expect(Math.abs(-d - numerical)).toBeGreaterThan(F.derivativeTolerance);
    // Old alpha endpoints describe a different derivative than the interpolated H.
    const h0 = reconstruct(15, input)[0],
      h1 = reconstruct(16, input)[0];
    const alphaD = (1 + C.derivativeAlpha) * (h1 - h0);
    expect(Math.abs(alphaD / 2 - numerical)).toBeGreaterThan(F.derivativeTolerance);
  });
  it('integrates a cubic field with host/physical time scaling and rejects missing scale', () => {
    for (const rate of E.rates) {
      const points = [0, 0, 0.125, 0.75 * rate, 1, 3 * rate];
      const core = { m: 0, slope: (_m, _h, d) => d };
      expect(step(core, points, 1 / rate, 'rk4')).toBeCloseTo(1, 14);
      core.m = 0;
      const unscaled = points.map((x, i) => (i % 2 ? x / rate : x));
      expect(Math.abs(step(core, unscaled, 1 / rate, 'rk4') - 1)).toBeGreaterThan(0.9);
    }
  });
  it('precomputed forcing matches direct convolution through startup and period boundaries', () => {
    const bins = [E.bins[1]],
      factor = R.diagnosticFactor;
    const field = new Field(bins, 2 * factor);
    const input = (n) => Math.sin((2 * Math.PI * bins[0] * n) / E.frames);
    for (const t of [0, 0.5, 31.875, 32, 127.875, 128, 8191.875, 8192, 8192.125]) {
      const expected = reconstruct(t, input);
      expect(field.at(t * field.grid)).toBeCloseTo(expected[0], 11);
      expect(field.at(t * field.grid, true)).toBeCloseTo(expected[1], 11);
    }
  });
});

describe('Filtered observation and integration', () => {
  it('pins impulse gain/delay to independent Simpson quadrature and state timestamps', () => {
    const factor = F.levels[0],
      frames = E.blockSize;
    const states = Float64Array.from(
      { length: frames * factor },
      (_, i) => reconstruct(i / factor, (n) => (n === 0 ? 1 : 0))[0],
    );
    const output = playback(states, factor, frames);
    expect(output.indexOf(Math.max(...output))).toBe(E.firSpan);
    let integral = 0;
    for (let i = 0; i <= F.normalizationPanels; i++) {
      const t = E.firSpan * (i / F.normalizationPanels - 0.5);
      const weight = i === 0 || i === F.normalizationPanels ? 1 : i % 2 ? 4 : 2;
      integral += weight * (kernel(t)[0] / NORM) ** 2;
    }
    integral *= E.firSpan / (3 * F.normalizationPanels);
    expect(Math.abs(output[E.firSpan] - integral)).toBeLessThan(F.identityTolerance);
    expect(Math.abs(output[E.firSpan - 1] - integral)).toBeGreaterThan(F.identityTolerance);
    const bins = [E.bins[1]],
      field = new Field(bins, 2 * factor);
    const r = render({
      rate: E.benchmarkRate,
      factor,
      field,
      signal: { bins, amplitude: 1, sign: 1 },
      frames,
      identity: true,
    });
    for (const n of [0, 1, E.firSpan, frames - 1]) expect(r.raw[n]).toBe(field.at(2 * n * factor));
  });
  it(
    'refines integration and output quadrature separately, and exposes a coarse candidate',
    () => {
      const signal = { bins: [E.bins.at(-1)], amplitude: 0.25, sign: 1 };
      const renders = [1, ...F.levels].map((factor) =>
        render({
          rate: E.benchmarkRate,
          factor,
          signal,
          field: new Field(signal.bins, 2 * factor),
        }),
      );
      for (const key of ['raw', 'frozen', 'output']) {
        const refs = renders.slice(1);
        const errors = refs
          .slice(0, -1)
          .map((r, i) => residual(r, refs[i + 1], { key, referenceKey: key }));
        expect(
          gate(
            errors,
            refs.map((r) => state(r, key)),
            R.highGateDb,
            R.settlingGateDb,
          ),
        ).toBe(true);
      }
      expect(residual(renders[0], renders.at(-1))).toBeGreaterThan(R.highGateDb);
      expect(residual(renders.at(-1), renders.at(-1), { key: 'frozen' })).toBeGreaterThan(-250);
    },
    F.testTimeoutMs,
  );
  it('preserves opposite remanence, DC and chunked advancement; aborts signed overload', () => {
    const run = (sign, chunk) => {
      const core = new Hysteresis(E.benchmarkRate);
      const field = (i) => {
        const angle = (Math.PI * i) / E.blockSize;
        return i <= E.blockSize
          ? [sign * Math.sin(angle), ((sign * Math.PI) / E.blockSize) * Math.cos(angle)]
          : [0, 0];
      };
      const samples = [];
      for (let start = 0; start < 2 * E.blockSize; start += chunk)
        for (let i = start; i < Math.min(start + chunk, 2 * E.blockSize); i++) {
          const points = [i, i + 0.5, i + 1].flatMap((t) => field(t));
          samples.push(step(core, points, 1, 'rk4'));
        }
      return samples;
    };
    const positive = run(1, E.blockSize),
      negative = run(-1, E.blockSize);
    expect(positive).toEqual(run(1, 1));
    expect(Math.abs(positive.at(-1))).toBeGreaterThan(0.01);
    expect(positive.at(-1)).toBeCloseTo(-negative.at(-1), 12);
    for (const sign of R.histories) {
      const factor = R.diagnosticFactor;
      const input = (n) => (n < E.blockSize ? 0 : sign * E.stressLevels.at(-2));
      const field = {
        bins: [0],
        grid: 2 * factor,
        at: (i, derivative = false) => reconstruct(i / (2 * factor), input)[derivative ? 1 : 0],
      };
      const r = render({
        rate: E.benchmarkRate,
        factor,
        field,
        frames: F.boundaryFrames,
        signal: { bins: [0], amplitude: 1, sign: 1 },
      });
      expect(r.failure).not.toBeNull();
      expect(r.finite).toBe(false);
      expect(r.resets + r.clips).toBe(0);
      expect(r.output[0]).toBe(0);
      expect(Number.isNaN(r.output.at(-1))).toBe(true);
    }
  });
});

describe('Honest reference and residual gates', () => {
  it('rejects incomplete pairs, silence, resets, invalid output and unsettled windows', () => {
    const good = {
      finite: true,
      peak: 1,
      resets: 0,
      clips: 0,
      failure: null,
      extendedSettlingDb: -100,
    };
    const passes = (errors, states) => gate(errors, states, R.lowMidGateDb, R.settlingGateDb);
    expect(passes([-90, -90], [good, good, good])).toBe(true);
    expect(passes([-50, -90], [good, good, good])).toBe(false);
    expect(passes([-90], [good, good])).toBe(false);
    expect(passes([null, -90], [good, good, good])).toBe(false);
    for (const mutation of [
      { peak: 0 },
      { resets: 1 },
      { clips: 1 },
      { finite: false },
      { failure: 'invalid' },
      { extendedSettlingDb: -50 },
      { extendedSettlingDb: null },
    ])
      expect(passes([-90, -90], [good, good, { ...good, ...mutation }])).toBe(false);
  });
  it('retains gain/DC and rejects a one-sample shift without fitting', () => {
    const output = Float64Array.from({ length: E.frames * 3 }, (_, i) =>
      Math.sin((2 * Math.PI * E.bins[1] * i) / E.frames),
    );
    const reference = {
      output,
      plan: { principalPeriod: 1, extendedPeriod: 2 },
      resets: 0,
      clips: 0,
    };
    const actual = { ...reference, output: Float64Array.from(output, (x) => 0.5 * x) };
    expect(residual(actual, reference)).toBeCloseTo(20 * Math.log10(0.5), 10);
    expect(residual(reference, reference, { delay: 1 })).toBeGreaterThan(R.lowMidGateDb);
    expect(residual({ ...actual, resets: 1 }, reference)).toBeNull();
    expect(
      residual({ ...reference, output: Float64Array.from(output, (x) => x + 0.1) }, reference),
    ).toBeGreaterThan(-30);
    expect(() => window(reference, false, E.frames + 1)).toThrow();
    expect(errorDb(window(reference), window(reference))).toBe(-300);
  });
});

describe('Reproducible report domains', () => {
  const report = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/research/2026-09-30-tape-filtered-reference/measurement.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  it('preserves stimulus amplitudes and refinement factors in separate settings', () => {
    expect(report.settings.experiment).toEqual(E);
    expect(report.settings.reference).toEqual(R);
    expect(report.settings.filtered).toEqual(F);
    expect(report.settings.experiment.levels).toEqual([0.01, 0.25, 1, 4]);
    expect(report.settings.filtered.levels).toEqual([16, 32, 64]);
    expect(report.settings).not.toHaveProperty('levels');
  });
  it('records each signed pulse exactly once per rate/solver with the actual plateau polarity', () => {
    const expected = E.rates.flatMap((rate) =>
      E.solvers.flatMap((solver) => F.boundaryLevels.map((level) => [rate, solver, level].join())),
    );
    const keys = report.boundaries.map(({ rate, solver, level }) => [rate, solver, level].join());
    expect(new Set(F.boundaryLevels).size).toBe(9);
    expect(keys).toHaveLength(54);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expected);
    for (const row of report.boundaries) {
      expect(row).not.toHaveProperty('sign');
      const plateau = row.points.find(({ t }) => t === 160).field[0];
      expect(Math.sign(plateau)).toBe(Math.sign(row.level));
      if (row.level !== 0) expect(plateau / row.level).toBeCloseTo(1, 5);
    }
    expect(report.boundaries.filter((row) => row.failure)).toHaveLength(24);
    expect(report.boundaries.filter((row) => row.finite)).toHaveLength(30);
  });
  it('renders the signed level without a second polarity multiplier', () => {
    const rows = [-1, 1].map((level) =>
      boundaryTrial({ rate: E.benchmarkRate, solver: 'rk4', level }),
    );
    for (const row of rows) {
      expect(row.failure).toBeNull();
      expect(row.finite).toBe(true);
      const plateau = row.points.find(({ t }) => t === 160);
      expect(Math.sign(plateau.field[0])).toBe(row.level);
      expect(Math.sign(plateau.raw)).toBe(row.level);
      expect(Math.sign(plateau.output)).toBe(row.level);
      const recorded = report.boundaries.find(
        (r) => r.rate === row.rate && r.solver === row.solver && r.level === row.level,
      );
      const { final, fieldPeak, points, ...metadata } = row;
      const {
        final: recordedFinal,
        fieldPeak: recordedPeak,
        points: recordedPoints,
        ...recordedMetadata
      } = recorded;
      expect(metadata).toEqual(recordedMetadata);
      // The Mac report and Linux CI differ in floating-point transcendental results.
      // Keep polarity above exact; this is report agreement, not a DSP golden.
      expect(final).toBeCloseTo(recordedFinal, 12);
      expect(fieldPeak).toBeCloseTo(recordedPeak, 12);
      expect(points).toHaveLength(recordedPoints.length);
      for (const [i, point] of points.entries()) {
        const expected = recordedPoints[i];
        expect(point.t).toBe(expected.t);
        expect(point.field).toHaveLength(expected.field.length);
        point.field.forEach((value, j) => expect(value).toBeCloseTo(expected.field[j], 12));
        expect(point.raw).toBeCloseTo(expected.raw, 12);
        expect(point.output).toBeCloseTo(expected.output, 12);
      }
    }
    expect(rows[0].final).toBeCloseTo(-rows[1].final, 12);
  });
});
