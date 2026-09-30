/* global structuredClone */
/** Verification fixtures are not additional reference-domain experiments. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  BOUNDARY as B,
  CORE as C,
  cases,
} from '../../docs/research/2026-09-30-tape-boundary-reference/boundaryConstants.ts';
import {
  equation,
  Diagnostics,
} from '../../docs/research/2026-09-30-tape-boundary-reference/diagnostics.ts';
import {
  renderBoundary,
  fixedObservation,
} from '../../docs/research/2026-09-30-tape-boundary-reference/boundaryReference.ts';
import {
  valid,
  compare,
  group,
  complete,
  baselineCheck,
  assemble,
} from '../../docs/research/2026-09-30-tape-boundary-reference/evidence.mjs';
import {
  configured,
  renderConditioned,
  condition,
} from '../../docs/research/2026-09-30-tape-conditioning/conditioning.ts';
import { render } from '../../docs/research/2026-09-30-tape-filtered-reference/filteredReference.ts';
import { NORM } from '../../docs/research/2026-09-30-tape-filtered-reference/reconstruction.ts';
import { recoverJournal } from '../../docs/research/2026-09-30-tape-conditioning/journal.mjs';

const rows = cases();
const qualified = (a, p, done = true) => group(rows[0], a, p, done).qualified;
const synthetic = (row, factor) => ({
  id: row.id,
  factor,
  state: { finite: true, failure: null, resets: 0, clips: 0 },
  samples: Object.fromEntries(
    ['raw', 'output', 'fixed'].map((key) => [key, Array(B.frames).fill(0)]),
  ),
});
const trials = () => B.levels.flatMap((factor) => rows.map((row) => synthetic(row, factor)));
const pairs = () =>
  B.levels
    .slice(1)
    .flatMap((factor, i) =>
      rows.map((row) => compare(synthetic(row, B.levels[i]), synthetic(row, factor))),
    );

describe('Stage instrumentation', () => {
  it('preserves original renders exactly on eight short signed synthetic verification trajectories', () => {
    for (const row of rows) {
      const factor = 16,
        sign = Math.sign(row.level),
        frames = 64;
      const field = {
        grid: 2 * factor,
        bins: [0],
        at: (i, d) => (d ? sign / 8 : (sign * i) / (16 * factor)),
      };
      const actual = renderBoundary({ row, factor, field, frames });
      const source = renderConditioned({ ...row, signal: row, factor, field, frames });
      for (const key of ['raw', 'output']) expect(actual[key]).toEqual(source[key]);
      for (const key of ['final', 'finite', 'failure', 'failureIndex', 'conditionedStages'])
        expect(actual[key]).toBe(source[key]);
    }
  });
  it('captures both distinct midpoint states and retains failure stages despite a zero detail cap', () => {
    const row = rows[0],
      factor = 16,
      h = 0.5,
      velocity = B.rate * 1e8,
      dt = 1 / (B.rate * factor);
    const field = { grid: 2 * factor, bins: [0], at: (_i, d) => (d ? velocity / B.rate : h) };
    const r = renderBoundary({ row, factor, field, frames: 1 }, { ...B, crossingCap: 0 });
    const c = configured(B.rate * factor, row.controls, 'knee');
    const k1 = dt * c.slope(0, h, velocity),
      k2 = dt * c.slope(k1 / 2, h, velocity);
    const k3 = dt * c.slope(k2 / 2, h, velocity);
    expect(r.failure).toMatch(/Invalid reference state/);
    expect(r.resets + r.clips).toBe(0);
    expect(r.diagnostics.failureStages.map((s) => s.m)).toEqual([0, k1 / 2, k2 / 2, k3]);
    expect(k1 / 2).not.toBe(k2 / 2);
    expect(r.diagnostics.failureStages.map((s) => s.stage)).toEqual([1, 2, 3, 4]);
    expect(r.diagnostics.failureStages.map((s) => s.time)).toEqual([
      0,
      0.5 / factor,
      0.5 / factor,
      1 / factor,
    ]);
    expect(r.output[0]).toBeNaN();
  });
  it('checks equation terms independently in both series branches and magnetic directions', () => {
    const core = configured(B.rate, B.controls[1], 'knee');
    for (const q of [-3, -0.02, -0.009, 0, 0.009, 0.02, 3])
      for (const m of [-0.2, 0.2])
        for (const velocity of [-2, 0, 2]) {
          const h = core.a * q - C.alpha * m,
            e = equation(core, { m, h, velocity });
          const l = (x) =>
            Math.abs(x) < 0.01
              ? x / 3 - x ** 3 / 45 + (2 * x ** 5) / 945
              : 1 / Math.tanh(x) - 1 / x;
          const delta = 1e-6,
            prime = (l(q + delta) - l(q - delta)) / (2 * delta);
          expect(e.q).toBeCloseTo(q, 13);
          expect(e.difference).toBeCloseTo(core.ms * l(q) - m, 13);
          expect(e.reversibleDenominator).toBeCloseTo(
            1 - ((C.alpha * prime * core.ms) / core.a) * core.c,
            7,
          );
          expect(e.irreversible).toBe((velocity >= 0 ? 1 : -1) * e.difference > 0);
          expect(e.predictedSlope).toBe(core.slope(m, h, velocity));
        }
    const m = ((1 - core.c) * C.k) / -C.alpha;
    expect(equation(core, { m, h: -C.alpha * m, velocity: 1 }).predictedSlope).toBeNaN();
  });
  it('counts capped stage-call transitions and labels same-time trial changes', () => {
    const trace = new Diagnostics(16, { ...B, crossingCap: 1 });
    const core = configured(B.rate, B.controls[0], 'knee');
    for (let i = 0; i < 5; i++) {
      const h = i % 2 ? 2 : -2,
        velocity = i % 2 ? 1 : -1,
        m = 0;
      const { predictedSlope, ...terms } = equation(core, { m, h, velocity });
      trace.observe({
        ...terms,
        predictedSlope,
        time: 128,
        step: 0,
        stage: i,
        sourceH: h,
        sourceVelocity: velocity,
        h,
        velocity,
        m,
        slope: predictedSlope,
        dtSlope: predictedSlope / B.rate,
      });
    }
    const x = trace.summary(true);
    for (const family of ['fieldZero', 'velocity']) {
      expect(x.crossings[family]).toMatchObject({ total: 4, windowTotal: 4, truncated: 3 });
      expect(x.crossings[family].retained).toHaveLength(1);
      expect(x.crossings[family].retained[0].stageTrialChange).toBe(true);
    }
    expect(x.failureStages).toHaveLength(5);
  });
  it('detects a missing knee derivative and independently reconstructs the correct derivative', () => {
    const row = rows[0],
      factor = 16,
      frames = 64;
    const field = { grid: 2 * factor, bins: [0], at: (i, d) => (d ? 1 / 8 : i / (16 * factor)) };
    const actual = renderBoundary({ row, factor, field, frames });
    const f = (t) => condition(t / 8, 'knee')[0];
    const force = (wrong) => ({
      ...field,
      at: (i, d) => {
        const t = i / (2 * factor),
          delta = 1e-5;
        return d ? (wrong ? 1 / 8 : (f(t + delta) - f(t - delta)) / (2 * delta)) : f(t);
      },
    });
    const good = render({ rate: B.rate, factor, frames, signal: row, field: force(false) });
    const bad = render({ rate: B.rate, factor, frames, signal: row, field: force(true) });
    const difference = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
    expect(difference(actual.raw, good.raw)).toBeLessThan(1e-7);
    expect(difference(actual.raw, bad.raw)).toBeGreaterThan(0.1);
  });
  it('checks the fixed observation against independent Blackman-sinc convolution', () => {
    const factor = 16,
      frames = 64;
    const states = Float64Array.from({ length: frames * factor }, (_, i) => 2 + i / factor / 10);
    const result = fixedObservation(states, factor, frames);
    const kernel = (t) =>
      Math.abs(t) >= 16
        ? 0
        : 0.9 *
          (t === 0 ? 1 : Math.sin(0.9 * Math.PI * t) / (0.9 * Math.PI * t)) *
          (0.42 + 0.5 * Math.cos((Math.PI * t) / 16) + 0.08 * Math.cos((Math.PI * t) / 8));
    let expected = 0;
    for (let j = 0; j <= 256; j++)
      expected += (kernel(j / 8 - 16) / (8 * NORM)) * states[(63 * 8 - j) * 2];
    expect(result[63]).toBeCloseTo(expected, 13);
    expect(() => fixedObservation(states, 17, frames)).toThrow(/Non-exact/);
  });
});

describe('Qualification and interrupted evidence', () => {
  it('requires two adjacent finest raw/full pairs with complete valid trajectories', () => {
    const a = trials(),
      p = pairs();
    expect(complete(a, p)).toBe(true);
    expect(qualified(a, p)).toBe(true);
    for (const key of ['raw', 'output']) {
      const bad = structuredClone(p);
      bad.find((v) => v.id === rows[0].id && v.to === 1024).errors[key] = 2e-7;
      expect(qualified(a, bad)).toBe(false);
    }
    expect(
      qualified(
        a,
        p.filter((v) => v.to !== 512),
      ),
    ).toBe(false);
    expect(
      qualified(
        a.filter((v) => v.factor !== 1024),
        p,
      ),
    ).toBe(false);
    expect(qualified(a, p, false)).toBe(false);
    expect(complete([...a, a[0]], p)).toBe(false);
    expect(complete(a.slice(1), p)).toBe(false);
    expect(complete(a, [...p, p[0]])).toBe(false);
  });
  it('refuses null/nonfinite/reset/clip evidence and retains unfitted gain/DC errors', () => {
    const a = trials(),
      p = pairs(),
      target = a.find((v) => v.id === rows[0].id && v.factor === 1024);
    for (const state of [{ finite: false }, { resets: 1 }, { clips: 1 }, { failure: 'failed' }]) {
      const bad = { ...target, state: { ...target.state, ...state } };
      expect(valid(bad)).toBe(false);
      expect(
        qualified(
          a.map((v) => (v === target ? bad : v)),
          p,
        ),
      ).toBe(false);
      expect(compare(target, bad).errors.raw).toBeNull();
    }
    for (const value of [null, NaN, Infinity]) {
      const bad = structuredClone(target);
      bad.samples.raw[0] = value;
      expect(valid(bad)).toBe(false);
    }
    const changed = structuredClone(target);
    changed.samples.output.fill(0.1);
    const errors = compare(target, changed).errors;
    expect(errors).toEqual({ raw: 0, output: 0.1, fixed: 0 });
    const badPairs = p.map((v) => (v.id === rows[0].id && v.to === 1024 ? { ...v, errors } : v));
    expect(qualified(a, badPairs)).toBe(false);
    const nullPair = p.map((v) =>
      v.to === 1024 ? { ...v, errors: { raw: null, output: 0, fixed: 0 } } : v,
    );
    expect(qualified(a, nullPair)).toBe(false);
  });
  it('recovers partial journals without computing new residuals or qualifying missing work', () => {
    const a = trials(),
      p = pairs();
    const entries = [
      ...a.map((value) => ({ kind: 'trial', value })),
      ...p.map((value) => ({ kind: 'pair', value })),
      { kind: 'baseline', value: { matches: true } },
    ];
    const run = { expired: false, exitCode: 0, truncatedTail: null };
    expect(assemble(entries, run).run.status).toBe('complete');
    const journal =
      entries
        .slice(0, -1)
        .map((e) => JSON.stringify(e) + '\n')
        .join('') + '{"kind":';
    const recovered = recoverJournal(journal);
    const report = assemble(recovered.entries, {
      ...run,
      expired: true,
      truncatedTail: recovered.truncatedTail,
    });
    expect(report.run.status).toBe('incomplete');
    expect(report.groups.every((g) => !g.qualified)).toBe(true);
    expect(report.run.truncatedTail).toBe('{"kind":');
    const missing = assemble(
      entries.filter((e) => !(e.kind === 'trial' && e.value.factor === 1024)),
      run,
    );
    expect(missing.missing).toHaveLength(4);
  });
});

describe('Saved report', () => {
  it('independently recomputes every residual, baseline anchor, count and qualification', () => {
    const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
    const report = read('../../docs/research/2026-09-30-tape-boundary-reference/measurement.json');
    const baseline = read('../../docs/research/2026-09-30-tape-conditioning/measurement.json');
    expect(report.settings.boundary).toEqual(B);
    expect(complete(report.trials, report.pairs)).toBe(true);
    expect(report.run.status).toBe('complete');
    expect(report.run.elapsedMs).toBeLessThanOrEqual(B.budgetMs);
    expect(baselineCheck(report.trials, report.pairs, baseline).matches).toBe(true);
    for (const p of report.pairs) {
      const a = report.trials.find((t) => t.id === p.id && t.factor === p.from);
      const b = report.trials.find((t) => t.id === p.id && t.factor === p.to);
      expect(compare(a, b)).toEqual(p);
    }
    for (const row of rows)
      expect(group(row, report.trials, report.pairs, true)).toEqual(
        report.groups.find((g) => g.id === row.id),
      );
    for (const t of report.trials)
      for (const x of Object.values(t.diagnostics.crossings)) {
        expect(x.retained.length + x.truncated).toBe(x.windowTotal);
        expect(x.retained.length).toBeLessThanOrEqual(B.crossingCap);
        expect(x.total).toBeGreaterThanOrEqual(x.windowTotal);
      }
  });
});
