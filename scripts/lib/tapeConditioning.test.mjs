/** Independent static-conditioning, falsification and report-contract checks. */
// reads-by-path: docs/research/*-tape-*/**
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  condition,
  stage,
  configured,
  pulseField,
  subgrid,
  renderConditioned,
} from '../../docs/research/2026-09-30-tape-conditioning/conditioning.ts';
import {
  CONDITIONING as K,
  EXPERIMENT as E,
  REFERENCE as R,
} from '../../docs/research/2026-09-30-tape-conditioning/conditioningConstants.ts';
import { matrix } from '../../docs/research/2026-09-30-tape-conditioning/matrix.ts';
import {
  qualifies,
  absolute,
  candidate,
  complete,
} from '../../docs/research/2026-09-30-tape-conditioning/evidence.mjs';
import { recoverJournal } from '../../docs/research/2026-09-30-tape-conditioning/journal.mjs';
import { render } from '../../docs/research/2026-09-30-tape-filtered-reference/filteredReference.ts';

describe('Static conditioning with the actual chain derivative', () => {
  it('counts the nonidentity region even when the conditioned field rounds unchanged', () => {
    const h = 1 + 2 * Number.EPSILON;
    expect(condition(h, 'knee')[0]).toBe(h);
    expect(condition(h, 'knee')[1]).toBeLessThan(1);
    const r = renderConditioned({
      rate: 48000,
      factor: 1,
      frames: 1,
      signal: { bins: [0], amplitude: 1, sign: 1 },
      controls: K.center,
      policy: 'knee',
      field: {
        grid: 2,
        bins: [0],
        at: (i, d) => (d ? Number.EPSILON : h + (i * Number.EPSILON) / 2),
      },
    });
    expect(r.conditionedStages).toBe(3);
  });
  it('preserves the identity and differentiates the odd C1 knee at both signs and extremes', () => {
    for (const h of [0, 1e-12, -1e-12, 1, -1]) expect(condition(h, 'knee')).toEqual([h, 1]);
    const independent = (h) => (Math.abs(h) <= 1 ? h : Math.sign(h) * (4 - 9 / (Math.abs(h) + 2)));
    for (const h of [-100, -8, -1.0001, -1, 0, 1, 1.0001, 8, 100]) {
      const [value, derivative] = condition(h, 'knee');
      const delta = 1e-5;
      const numerical = (independent(h + delta) - independent(h - delta)) / (2 * delta);
      expect(value).toBeCloseTo(independent(h), 13);
      expect(Math.abs(derivative - numerical)).toBeLessThan(2e-6);
      expect(stage(h, -3, 'knee')[1]).toBe(-3 * derivative);
    }
    expect(condition(Number.MAX_VALUE, 'knee')[0]).toBeLessThanOrEqual(4);
    expect(Math.abs(stage(8, 1, 'knee')[1] - 1)).toBeGreaterThan(0.9);
    for (const policy of K.policies) {
      expect(() => condition(NaN, policy)).toThrow();
      expect(() => stage(0, Infinity, policy)).toThrow();
    }
    for (const sign of [-1, 1]) expect(() => condition(sign * 9, 'unchanged')).toThrow();
  });
  it('changes only c and exposes the old negative endpoint without claiming instability', () => {
    for (const drive of K.endpoints)
      for (const width of K.endpoints)
        for (const sat of K.endpoints) {
          const original = configured(48000, [drive, width, sat], 'unchanged');
          const fixed = configured(48000, [drive, width, sat], 'nonnegative');
          expect(fixed.ms).toBe(0.5 + 1.5 * (1 - sat));
          expect(fixed.a).toBe(original.ms / (0.01 + 6 * drive));
          expect(fixed.c).toBe(Math.max(0, Math.sqrt(1 - width) - 0.01));
          if (width === 1) {
            expect(original.c).toBe(-0.01);
            expect(fixed.c).toBe(0);
          }
        }
    for (const controls of [
      [-1, 0, 0],
      [0, 2, 0],
      [0, 0, NaN],
      [0, 0, null],
      [0, 0],
    ])
      expect(() => configured(48000, controls, 'knee')).toThrow();
    for (const rate of [0, -1, Infinity, NaN])
      expect(() => configured(rate, K.center, 'knee')).toThrow();
  });
  it('matches independent finite-difference forcing at every RK stage; wrong derivative fails', () => {
    for (const solver of ['rk2', 'rk4'])
      for (const sign of [-1, 1]) {
        const factor = 4,
          rate = 48000,
          frames = 64;
        const base = {
          bins: [0],
          grid: 2 * factor,
          at: (i, d = false) => (d ? sign / 8 : (sign * i) / (16 * factor)),
        };
        const options = {
          rate,
          factor,
          frames,
          solver,
          signal: { bins: [0], amplitude: 1, sign: 1 },
        };
        const actual = renderConditioned({
          ...options,
          field: base,
          controls: K.center,
          policy: 'knee',
        });
        const f = (t) => {
          const h = (sign * t) / 8;
          return Math.abs(h) <= 1 ? h : Math.sign(h) * (4 - 9 / (Math.abs(h) + 2));
        };
        const expectedField = {
          ...base,
          at: (i, d = false) => {
            const t = i / (2 * factor),
              delta = 1e-5;
            return d ? (f(t + delta) - f(t - delta)) / (2 * delta) : f(t);
          },
        };
        const expected = render({ ...options, field: expectedField });
        expect(absolute(actual, expected, 'raw')).toBeLessThan(1e-7);
        const wrong = render({
          ...options,
          field: { ...expectedField, at: (i, d) => (d ? sign / 8 : expectedField.at(i)) },
        });
        expect(absolute(actual, wrong, 'raw')).toBeGreaterThan(0.1);
      }
  });
  it('keeps startup, return-to-zero and opposite remanence, and aborts without silence/reset', () => {
    const finals = [];
    for (const history of [-1, 1]) {
      const field = pulseField(0, history, 4);
      const options = {
        rate: 48000,
        factor: 4,
        frames: K.boundaryFrames,
        field,
        signal: { bins: [0], amplitude: 1, sign: 1 },
        controls: K.center,
        policy: 'knee',
      };
      const r = renderConditioned(options);
      expect(r.raw[0]).toBe(0);
      expect(r.finite).toBe(true);
      expect(Math.abs(r.final)).toBeGreaterThan(0.01);
      expect(r.raw.at(-1)).toBe(r.raw[128]);
      finals.push(r.final);
      const failed = renderConditioned({
        ...options,
        policy: 'unchanged',
        field: pulseField(history * 100, 0, 4),
      });
      expect(failed.failure).toMatch(/domain/);
      expect(failed.resets + failed.clips).toBe(0);
      expect(failed.failureIndex).toBeGreaterThan(0);
      expect(failed.output.at(-1)).toBeNaN();
      expect(absolute(r, failed, 'output')).toBeNull();
      expect(() => renderConditioned({ ...options, rate: NaN })).toThrow();
      expect(() => subgrid(field, 3)).toThrow();
      const half = subgrid(field, 2);
      for (const i of [0, 1, 127, 511]) expect(half.at(i, true)).toBe(field.at(2 * i, true));
    }
    expect(finals[0]).toBeCloseTo(-finals[1], 12);
  });
});

describe('Qualification cannot disguise missing or failed evidence', () => {
  const good = {
    finite: true,
    peak: 1,
    failure: null,
    resets: 0,
    clips: 0,
    extendedSettlingDb: -100,
  };
  const tone = { domain: 'center', bins: [17] },
    boundary = { domain: 'boundary' };
  it('needs both refinement pairs, finite nonzero tones and separate absolute boundary gates', () => {
    expect(qualifies([-90, -90], [good, good, good], tone)).toBe(true);
    for (const errors of [[-50, -90], [-90], [null, -90]])
      expect(qualifies(errors, [good, good, good], tone)).toBe(false);
    for (const mutation of [
      { peak: 0 },
      { finite: false },
      { resets: 1 },
      { clips: 1 },
      { failure: 'failed' },
      { extendedSettlingDb: -50 },
    ])
      expect(qualifies([-90, -90], [good, good, { ...good, ...mutation }], tone)).toBe(false);
    expect(qualifies([0, 0], [good, good, good], boundary)).toBe(true);
    expect(qualifies([0, 0], [good, good, good], tone)).toBe(false);
    expect(qualifies([0], [good, good], boundary)).toBe(false);
    expect(qualifies([0, 0], [good, good, { ...good, resets: 1 }], boundary)).toBe(false);
  });
  it('retains gain/DC and refuses reset/silent candidates despite a claimed qualified reference', () => {
    const output = Float64Array.from({ length: E.frames * 3 }, (_, n) =>
      Math.sin((2 * Math.PI * 17 * n) / E.frames),
    );
    const ref = { ...good, output, raw: output, final: 0, plan: R };
    const qualified = { raw: { passes: true }, output: { passes: true } };
    for (const change of [(x) => x / 2, (x) => x + 0.1, () => 0]) {
      const samples = Float64Array.from(output, change);
      const result = candidate({ ...ref, raw: samples, output: samples }, ref, tone, qualified);
      expect(result.passes).toBe(false);
      expect(result.output).toBeGreaterThan(-30);
    }
    expect(candidate({ ...ref, resets: 1 }, ref, tone, qualified).passes).toBe(false);
    const rawOnlyError = {
      ...ref,
      raw: Float64Array.from(output, (x) => x + 2 * K.absoluteCandidate),
    };
    const boundaryResult = candidate(rawOnlyError, ref, boundary, qualified);
    expect(boundaryResult.output).toBe(0);
    expect(boundaryResult.raw).toBeGreaterThan(K.absoluteCandidate);
    expect(boundaryResult.passes).toBe(false);
  });
  it('recovers completed records and preserves an interrupted final record', () => {
    expect(recoverJournal('{"kind":"trial"}\n{"kind":')).toEqual({
      entries: [{ kind: 'trial' }],
      truncatedTail: '{"kind":',
    });
    expect(recoverJournal('')).toEqual({ entries: [], truncatedTail: null });
    expect(() => recoverJournal('bad\n')).toThrow();
  });
});

describe('Declared finite report matrix', () => {
  const expected = matrix();
  it('covers every promised control, polarity and independent magnetic history exactly once', () => {
    expect(expected).toHaveLength(K.expectedTones + K.expectedBoundaries);
    expect(new Set(expected.map((r) => r.id)).size).toBe(expected.length);
    expect(expected.filter((r) => r.domain === 'center')).toHaveLength(216);
    expect(expected.filter((r) => r.domain === 'corner')).toHaveLength(288);
    expect(expected.filter((r) => r.domain === 'boundary')).toHaveLength(297);
  });
  it('accounts for missing/partial trials explicitly and keeps settings namespaces intact', () => {
    const report = JSON.parse(
      readFileSync(
        new URL(
          '../../docs/research/2026-09-30-tape-conditioning/measurement.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(report.settings.conditioning).toEqual(K);
    expect(report.settings.experiment).toEqual(E);
    expect(report.settings.reference).toEqual(R);
    expect(report.settings).not.toHaveProperty('levels');
    expect([...report.groups, ...report.missing].map((r) => r.id).sort()).toEqual(
      expected.map((r) => r.id).sort(),
    );
    expect(report.run.status === 'complete').toBe(complete(report, expected));
    expect(complete({ groups: report.groups.slice(1) }, expected)).toBe(false);
    for (const g of report.groups) {
      expect(g.references.raw.levels).toEqual([16, 32, 64]);
      expect(g.references.output.errors).toHaveLength(2);
      expect(g.candidates.map((c) => [c.solver, c.factor])).toEqual(
        K.candidates.map((c) => [c.solver, c.factor]),
      );
      if (g.centerRegression?.identity) {
        expect(g.centerRegression.rawMaximumDifference).toBe(0);
        expect(g.centerRegression.outputMaximumDifference).toBe(0);
      }
      if (g.domain === 'boundary') {
        const plateau = g.inputPoints.find((p) => p.t === 160);
        expect(plateau.sample).toBe(g.level);
        expect(Math.sign(plateau.reconstructed)).toBe(Math.sign(g.level));
        expect(g.inputPoints[0].sample).toBe(g.history);
      }
      for (const c of g.candidates)
        if (c.passes) {
          expect(c.referenceQualified).toBe(true);
          expect(c.state.finite).toBe(true);
        }
    }
  });
});
