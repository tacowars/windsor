/* global structuredClone */
/** Verification fixtures for windsor#188; not additional reference experiments. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  OVERLOAD as O,
  cases,
} from '../../docs/research/2026-09-30-tape-overload-reference/overloadConstants.ts';
import { BOUNDARY as B } from '../../docs/research/2026-09-30-tape-boundary-reference/boundaryConstants.ts';
import {
  compare,
  group,
  complete,
  assemble,
} from '../../docs/research/2026-09-30-tape-boundary-reference/evidence.mjs';
import {
  located,
  anchorCheck,
  verdict,
  interpret,
} from '../../docs/research/2026-09-30-tape-overload-reference/evidence.mjs';
import { recoverJournal } from '../../docs/research/2026-09-30-tape-conditioning/journal.mjs';

const rows = cases(O);
const synthetic = (row, factor) => ({
  id: row.id,
  factor,
  state: { finite: true, failure: null, resets: 0, clips: 0, final: 0 },
  samples: Object.fromEntries(
    ['raw', 'output', 'fixed'].map((key) => [key, Array(O.frames).fill(0)]),
  ),
});
const trials = () => O.levels.flatMap((factor) => rows.map((row) => synthetic(row, factor)));
const pairs = () =>
  O.levels
    .slice(1)
    .flatMap((factor, i) =>
      rows.map((row) => compare(synthetic(row, O.levels[i]), synthetic(row, factor), O)),
    );
/** Set the first case's pair ending at `to` to these errors. */
const withErrors = (p, to, errors) =>
  p.map((v) =>
    v.id === rows[0].id && v.to === to ? { ...v, errors: { ...v.errors, ...errors } } : v,
  );
const miss = { raw: 2e-7, output: 2e-7 };
const report = (a, p, run = {}) => {
  const entries = [
    ...a.map((value) => ({ kind: 'trial', value })),
    ...p.map((value) => ({ kind: 'pair', value })),
    { kind: 'baseline', value: { matches: true } },
  ];
  return assemble(entries, { expired: false, exitCode: 0, truncatedTail: null, ...run }, O);
};
const first = (r) => interpret(r).cases[0];

describe('Declared overload matrix', () => {
  it('changes only the ladder and cases of #183, keeping ids, gates, windows and caps', () => {
    const { levels, controls, amplitudes, anchor } = O;
    expect(levels).toEqual([1024, 2048, 4096, 8192]);
    expect(controls).toEqual([[1, 0, 0]]);
    expect(amplitudes).toEqual([100]);
    expect(anchor.factor).toBe(levels[0]);
    expect({ ...B, levels, controls, amplitudes, anchor }).toEqual(O);
    expect([O.tolerance, O.budgetMs, O.crossingCap]).toEqual([1e-7, 900000, 256]);
    expect(rows.map((r) => r.id)).toEqual(
      cases(B)
        .slice(2)
        .map((r) => r.id),
    );
    expect(rows.map((r) => [r.level, r.amplitude, r.sign, r.history])).toEqual([
      [100, 1, 1, 0],
      [-100, 1, 1, 0],
    ]);
    expect(trials()).toHaveLength(8);
    expect(pairs()).toHaveLength(6);
  });
});

describe('Qualification on the finest 2048/4096/8192 triple', () => {
  it('qualifies only when both finest pairs pass raw and full output', () => {
    const r = report(trials(), pairs());
    expect(r.run.status).toBe('complete');
    expect(interpret(r).outcome).toBe('both qualified');
    for (const key of ['raw', 'output']) {
      const bad = report(trials(), withErrors(pairs(), 8192, { [key]: 2e-7 }));
      expect(bad.groups[0].qualified).toBe(false);
      expect(first(bad).verdict).toBe('precision miss');
      expect(interpret(bad).outcome).toBe('one qualified');
      expect(interpret(bad).unqualified).toEqual([rows[0].id]);
    }
  });
  it('refuses one passing pair, the 1024-2048 pair alone, and a later failure after a pass', () => {
    const one = report(trials(), withErrors(pairs(), 4096, miss));
    expect(one.groups[0].qualified).toBe(false);
    expect(first(one).passingPairs).toEqual([
      [1024, 2048],
      [4096, 8192],
    ]);
    const early = report(trials(), withErrors(withErrors(pairs(), 4096, miss), 8192, miss));
    expect(early.groups[0].qualified).toBe(false);
    expect(first(early).passingPairs).toEqual([[1024, 2048]]);
    const later = report(trials(), withErrors(pairs(), 8192, miss));
    expect(later.groups[0].diagnosticPassingTriples).toEqual([[1024, 2048, 4096]]);
    expect(later.groups[0].qualified).toBe(false);
    expect(first(later).finest).toMatchObject(miss);
  });
  it('keeps fixed-8x observation diagnostic when full output fails', () => {
    const p = withErrors(pairs(), 8192, { raw: 0, output: 2e-7, fixed: 0 });
    expect(report(trials(), p).groups[0].qualified).toBe(false);
  });
  it('marks a missing 8192x row incomplete and unqualified', () => {
    const a = trials().filter((t) => !(t.id === rows[0].id && t.factor === 8192));
    const p = pairs().filter((v) => !(v.id === rows[0].id && v.to === 8192));
    const r = report(a, p);
    expect(r.run.status).toBe('incomplete');
    expect(r.missing).toEqual([`${rows[0].id}@8192`]);
    expect(r.missingComparisons).toEqual([`${rows[0].id}@4096:8192`]);
    expect(first(r).verdict).toBe('incomplete');
    expect(interpret(r).outcome).toBe('neither qualified');
  });
  it('separates nonfinite, reset and clip states from precision misses', () => {
    for (const state of [{ finite: false }, { resets: 1 }, { clips: 1 }, { failure: 'guard' }]) {
      const a = trials().map((t) =>
        t.id === rows[0].id && t.factor === 8192 ? { ...t, state: { ...t.state, ...state } } : t,
      );
      const before = a.find((t) => t.id === rows[0].id && t.factor === 4096);
      const after = a.find((t) => t.id === rows[0].id && t.factor === 8192);
      const p = pairs().map((v) =>
        v.id === rows[0].id && v.to === 8192 ? compare(before, after, O) : v,
      );
      expect(p.find((v) => v.id === rows[0].id && v.to === 8192).errors.raw).toBeNull();
      expect(located(before, after).raw).toBeNull();
      const r = report(a, p);
      expect(r.groups[0].qualified).toBe(false);
      expect(first(r).verdict).toBe('state failure');
    }
  });
  it('never qualifies an expired or failed-anchor run even when every pair passes', () => {
    for (const run of [{ expired: true }, { exitCode: null }]) {
      const r = report(trials(), pairs(), run);
      expect(r.run.status).toBe('incomplete');
      expect(first(r).verdict).toBe('unqualified run');
      expect(interpret(r).outcome).toBe('neither qualified');
    }
    const entries = [
      ...trials().map((value) => ({ kind: 'trial', value })),
      ...pairs().map((value) => ({ kind: 'pair', value })),
      { kind: 'baseline', value: { matches: false } },
    ];
    const run = { expired: false, exitCode: 0, truncatedTail: null };
    expect(assemble(entries, run, O).groups.every((g) => !g.qualified)).toBe(true);
  });
  it('refuses duplicate and missing case identities', () => {
    const a = trials(),
      p = pairs();
    expect(complete(a, p, O)).toBe(true);
    expect(complete([...a, a[0]], p, O)).toBe(false);
    expect(complete(a.slice(1), p, O)).toBe(false);
    expect(complete(a, [...p, p[0]], O)).toBe(false);
    expect(complete(a, p.slice(1), O)).toBe(false);
    expect(group(rows[0], [...a, a.at(-2)], p, true, O).qualified).toBe(false);
    expect(report([...a, a.at(-2)], p).run.status).toBe('incomplete');
  });
});

describe('Interrupted evidence and the 1024x anchor', () => {
  it('recovers completed records, keeps a partial tail and leaves missing trials unqualified', () => {
    const lines = [
      ...trials()
        .slice(0, 5)
        .map((value) => ({ kind: 'trial', value })),
      ...pairs()
        .slice(0, 2)
        .map((value) => ({ kind: 'pair', value })),
    ];
    const text = `${lines.map((e) => JSON.stringify(e)).join('\n')}\n{"kind":"tri`;
    const recovered = recoverJournal(text);
    expect(recovered.entries).toHaveLength(7);
    const r = assemble(
      recovered.entries,
      { expired: true, exitCode: null, truncatedTail: recovered.truncatedTail },
      O,
    );
    expect(r.run).toMatchObject({
      status: 'incomplete',
      truncatedTail: '{"kind":"tri',
      completedTrajectories: 5,
      requestedTrajectories: 8,
      completedComparisons: 2,
      requestedComparisons: 6,
    });
    expect(r.missing).toHaveLength(3);
    expect(r.groups.every((g) => !g.qualified)).toBe(true);
    expect(interpret(r).cases.map((c) => c.verdict)).toEqual(['incomplete', 'incomplete']);
  });
  it('matches saved anchor rows exactly and reports any changed sample or final state', () => {
    const anchored = (t, i) => ({
      ...t,
      state: { ...t.state, final: Math.sign(rows[i].level) * O.anchor.final },
      summaries: { raw: {} },
      diagnostics: { stages: 1 },
    });
    const a = rows.map((row, i) => anchored(synthetic(row, 1024), i));
    const saved = { trials: structuredClone(a) };
    expect(anchorCheck(a, saved).matches).toBe(true);
    const changed = structuredClone(saved);
    changed.trials[1].samples.output[511] = 1e-300;
    expect(anchorCheck(a, changed).checks.map((c) => c.matches)).toEqual([true, false]);
    const flipped = structuredClone(a);
    flipped[0].state.final = -flipped[0].state.final;
    expect(anchorCheck(flipped, { trials: flipped }).matches).toBe(false);
    expect(anchorCheck(a.slice(1), saved).matches).toBe(false);
    expect(anchorCheck([...a, a[0]], saved).matches).toBe(false);
  });
  it('locates the first maximum frame on both integration grids', () => {
    const a = synthetic(rows[0], 4096),
      b = synthetic(rows[0], 8192);
    b.samples.raw[143] = 3e-7;
    b.samples.raw[300] = -3e-7;
    b.samples.output[288] = 1e-7;
    expect(located(a, b)).toEqual({
      raw: { frame: 143, fromStep: 143 * 4096, toStep: 143 * 8192, stage: 1 },
      output: { frame: 288, fromStep: 288 * 4096, toStep: 288 * 8192, stage: 1 },
    });
  });
});

describe('Saved report', () => {
  it('independently recomputes residuals, maxima, anchor, counts and the outcome', () => {
    const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
    const saved = read('../../docs/research/2026-09-30-tape-overload-reference/measurement.json');
    const anchor = read('../../docs/research/2026-09-30-tape-boundary-reference/measurement.json');
    expect(saved.settings.overload).toEqual(O);
    expect(saved.run.expired || saved.run.elapsedMs <= O.budgetMs).toBe(true);
    expect(saved.run.requestedTrajectories).toBe(8);
    expect(saved.run.requestedComparisons).toBe(6);
    const done = saved.trials.filter((t) => t.factor === O.anchor.factor);
    if (done.length === rows.length)
      expect(anchorCheck(saved.trials, anchor)).toEqual(saved.baseline);
    for (const p of saved.pairs) {
      const a = saved.trials.find((t) => t.id === p.id && t.factor === p.from);
      const b = saved.trials.find((t) => t.id === p.id && t.factor === p.to);
      const errors = Object.fromEntries(
        ['raw', 'output', 'fixed'].map((key) => [
          key,
          a.state.finite && b.state.finite
            ? Math.max(...a.samples[key].map((x, i) => Math.abs(x - b.samples[key][i])))
            : null,
        ]),
      );
      expect(p).toEqual({ id: b.id, from: a.factor, to: b.factor, errors, maxima: located(a, b) });
    }
    const finished = saved.run.status === 'complete';
    expect(finished).toBe(complete(saved.trials, saved.pairs, O) && saved.baseline?.matches);
    for (const row of rows)
      expect(group(row, saved.trials, saved.pairs, finished, O)).toEqual(
        saved.groups.find((g) => g.id === row.id),
      );
    expect(interpret(saved)).toEqual(saved.outcome);
    for (const t of saved.trials)
      for (const x of Object.values(t.diagnostics.crossings)) {
        expect(x.retained.length + x.truncated).toBe(x.windowTotal);
        expect(x.retained.length).toBeLessThanOrEqual(O.crossingCap);
      }
    expect(verdict(saved.groups[0], saved)).toBe(saved.outcome.cases[0].verdict);
  });
});
