/** Independent reconstruction, timestamps and qualification checks for Windsor #150. */
import { describe, expect, it } from 'vitest';
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
