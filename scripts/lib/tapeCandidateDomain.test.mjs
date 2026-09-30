/** Verification fixtures for windsor#197; not additional candidate experiments. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import {
  CANDIDATE as C,
  schedule,
  settings,
} from '../../docs/research/2026-09-30-tape-candidate-domain/candidateConstants.ts';
import {
  BOUNDARY,
  cases,
} from '../../docs/research/2026-09-30-tape-boundary-reference/boundaryConstants.ts';
import {
  renderConditioned,
  pulseField,
  subgrid,
} from '../../docs/research/2026-09-30-tape-conditioning/conditioning.ts';
import { Hysteresis } from '../../docs/research/2026-09-30-tape-phase-3/hysteresis.ts';
import { recoverJournal } from '../../docs/research/2026-09-30-tape-conditioning/journal.mjs';
import * as V from '../../docs/research/2026-09-30-tape-candidate-domain/evidence.mjs';

const dir = '../../docs/research/2026-09-30-tape-candidate-domain/';
const bytes = (path) => readFileSync(new URL(path, new URL(dir, import.meta.url)));
const read = (path) => ({
  sha256: createHash('sha256').update(bytes(path)).digest('hex'),
  report: JSON.parse(bytes(path).toString('utf8')),
});
const rows = schedule(C);
const accuracyRows = rows.filter((r) => r.part === 'accuracy');
const zeros = () => Array(C.frames).fill(0);
const synthetic = (row, extra = {}) => ({
  ...{ part: row.part, id: row.id, controls: row.controls, level: row.level },
  ...{ solver: row.solver, factor: row.factor, finite: true, failure: null, failureIndex: null },
  ...{ failureTime: null, resets: 0, clips: 0, final: 0, peakM: 0, peakSlope: 0 },
  nonfiniteSlopes: 0,
  ...(row.part === 'accuracy'
    ? {
        samples: { raw: zeros(), output: zeros() },
        errors: { raw: { error: 0, frame: 0 }, output: { error: 0, frame: 0 } },
      }
    : {}),
  ...extra,
});
const anchorOk = {
  checks: [...new Set(accuracyRows.map((r) => r.id))].map((id) => ({ id, matches: true })),
  matches: true,
};
const entries = (trials, anchor = anchorOk) => [
  { kind: 'anchor', value: anchor },
  ...trials.map((value) => ({ kind: 'trial', value })),
];
const run = { expired: false, exitCode: 0, truncatedTail: null, elapsedMs: 1 };
const assembled = (trials, anchor, r = run) => V.assemble(entries(trials, anchor), r, C);
const first = (report) => report.accuracy[0];
const override = (index, extra) => rows.map((row, i) => synthetic(row, i === index ? extra : {}));

describe('Declared candidate matrix', () => {
  it('declares eight settings, four ruler cases, sixteen levels, two controls and 288 trajectories', () => {
    expect(settings(C).map((s) => `${s.solver}/${s.factor}`)).toEqual([
      ...['rk2/1', 'rk2/2', 'rk2/4', 'rk2/8', 'rk4/1', 'rk4/2', 'rk4/4', 'rk4/8'],
    ]);
    expect([C.limit, C.budgetMs, C.rate, C.frames, C.policy, C.history]).toEqual([
      1e-5,
      900000,
      48000,
      512,
      'knee',
      0,
    ]);
    expect(C.levels.flatMap((l) => C.signs.map((s) => s * l))).toHaveLength(16);
    expect(C.controls).toEqual([
      [0.5, 0.5, 0.5],
      [1, 0, 0],
    ]);
    expect(rows).toHaveLength(288);
    expect(accuracyRows).toHaveLength(32);
    expect([...new Set(accuracyRows.map((r) => r.id))]).toEqual(cases(BOUNDARY).map((r) => r.id));
    expect(rows.slice(0, 32).every((r) => r.part === 'accuracy')).toBe(true);
    const levels = rows.slice(32).map((r) => Math.abs(r.level));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(rows.every((r) => r.amplitude === 1 && r.sign === 1 && r.history === 0)).toBe(true);
    expect(C.rulers.map((r) => [r.factor, r.final])).toEqual([
      [1024, 0.05341405966564157],
      [8192, 1.694384147775507e-5],
    ]);
  });
  it('observes slopes and states without changing the trajectory', () => {
    const row = { ...rows[0], solver: 'rk2', factor: 1 };
    const field = pulseField(row.level, 0, C.factors.at(-1));
    const options = { ...row, signal: row, field: subgrid(field, 1), frames: C.frames };
    const plain = renderConditioned(options);
    const observer = V.observe(Hysteresis);
    try {
      const seen = V.renderCandidate({ renderConditioned, subgrid }, { row, field, observer });
      expect(seen.samples.raw).toEqual(Array.from(plain.raw));
      expect(seen.samples.output).toEqual(Array.from(plain.output));
      expect(seen.final).toBe(plain.final);
      expect(seen.peakSlope).toBeGreaterThan(0);
      expect(seen.peakM).toBeGreaterThanOrEqual(Math.max(...plain.raw.map(Math.abs)));
    } finally {
      observer.restore();
    }
  });
});

describe('Part 1 gate', () => {
  it('passes only a complete, anchored, valid trajectory within the limit on raw and full', () => {
    expect(first(assembled(rows.map((r) => synthetic(r)))).passes).toBe(true);
    const failing = [
      { errors: { raw: { error: 2e-5, frame: 1 }, output: { error: 0, frame: 0 } } },
      { errors: { raw: { error: 0, frame: 0 }, output: { error: 2e-5, frame: 1 } } },
      { errors: { raw: null, output: null } },
      { finite: false },
      { resets: 1 },
      { clips: 1 },
      { failure: 'Error: Invalid reference state', failureIndex: 7 },
    ];
    for (const extra of failing) expect(first(assembled(override(0, extra))).passes).toBe(false);
  });
  it('fails a missing ruler row, a failed anchor and an expired run', () => {
    const t = synthetic(accuracyRows[0]);
    expect(V.accuracy(t, null)).toEqual({ raw: null, output: null });
    const noRow = (path) => ({ ...read(path), report: { trials: [] } });
    expect(V.anchors(noRow).matches).toBe(false);
    const badHash = (path) => ({ ...read(path), sha256: '0' });
    expect(V.anchors(badHash).checks.every((c) => !c.matches)).toBe(true);
    const failed = { checks: anchorOk.checks.map((c) => ({ ...c, matches: false })) };
    expect(
      first(
        assembled(
          rows.map((r) => synthetic(r)),
          failed,
        ),
      ).passes,
    ).toBe(false);
    const expired = assembled(
      rows.map((r) => synthetic(r)),
      anchorOk,
      { ...run, expired: true },
    );
    expect(expired.run.status).toBe('incomplete');
    expect(expired.accuracy.some((a) => a.passes)).toBe(false);
  });
  it('reports a surviving trajectory above the limit as surviving and failing', () => {
    const errors = { raw: { error: 2e-5, frame: 273 }, output: { error: 0, frame: 0 } };
    const r = assembled(override(0, { errors }));
    expect(first(r)).toMatchObject({ survives: true, passes: false });
  });
  it('refuses duplicates and missing trajectories', () => {
    const all = rows.map((r) => synthetic(r));
    expect(assembled([...all, all[0]]).run.status).toBe('incomplete');
    const r = assembled(all.slice(1));
    expect(r.missing).toEqual([V.key(rows[0])]);
    expect(first(r)).toMatchObject({ present: false, passes: false });
  });
});

describe('Part 2 survival map', () => {
  it('reports the largest and contiguous surviving level and calls out a non-monotone row', () => {
    expect(V.extent([true, true, false, false], [1, 2, 4, 8])).toMatchObject({
      largest: 2,
      contiguous: 2,
      monotone: true,
    });
    expect(V.extent([true, false, true, false], [1, 2, 4, 8])).toMatchObject({
      largest: 4,
      contiguous: 1,
      monotone: false,
    });
    const lost = rows.findIndex(
      (r) => r.part === 'survival' && r.level === 2 && r.solver === 'rk2',
    );
    const r = assembled(override(lost, { failure: 'guard', finite: false }));
    const row = r.survival.find((s) => s.solver === 'rk2' && s.factor === rows[lost].factor);
    expect(row).toMatchObject({ largest: 100, contiguous: 1, monotone: false, complete: true });
    expect(V.interpret(r, C).survival[0].nonMonotone).toEqual([`rk2/${rows[lost].factor}`]);
    expect(V.interpret(r, C).survival[0].everySettingSurvivesTo).toBe(1);
  });
  it('recovers an interrupted journal and leaves missing levels unknown', () => {
    const text = entries(rows.slice(0, 40).map((r) => synthetic(r)))
      .map((e) => JSON.stringify(e))
      .join('\n');
    const recovered = recoverJournal(`${text}\n{"kind":"tri`);
    expect(recovered.entries).toHaveLength(41);
    const r = V.assemble(
      recovered.entries,
      { expired: true, exitCode: null, truncatedTail: recovered.truncatedTail },
      C,
    );
    expect(r.run).toMatchObject({ status: 'incomplete', completedTrajectories: 40 });
    expect(r.run.truncatedTail).toBe('{"kind":"tri');
    expect(r.missing).toHaveLength(248);
    expect(r.accuracy.some((a) => a.passes)).toBe(false);
    expect(r.survival.every((s) => !s.complete && s.levels.at(-1).survives === null)).toBe(true);
  });
});

describe('Saved report', () => {
  const saved = read('measurement.json').report;
  const trial = (row) => saved.trials.find((t) => V.key(t) === V.key(row));
  it('identifies both rulers and recomputes every part 1 error and frame independently', () => {
    expect(saved.settings.candidate).toEqual(C);
    expect(saved.run.expired || saved.run.elapsedMs <= C.budgetMs).toBe(true);
    expect(V.anchors(read)).toEqual(saved.anchor);
    for (const ruler of C.rulers) expect(read(ruler.path).sha256).toBe(ruler.sha256);
    for (const row of accuracyRows) {
      const t = trial(row),
        ruler = C.rulers.find((r) => r.amplitude === Math.abs(row.level));
      const ref = read(ruler.path).report.trials.find(
        (x) => x.id === row.id && x.factor === ruler.factor,
      );
      expect(Math.abs(ref.state.final)).toBe(ruler.final);
      const ok = t.finite && !t.failure && t.samples.raw.every(Number.isFinite);
      for (const key of ['raw', 'output']) {
        const diff = ok ? t.samples[key].map((x, i) => Math.abs(x - ref.samples[key][i])) : null;
        const error = diff && Math.max(...diff);
        expect(t.errors[key]).toEqual(ok ? { error, frame: diff.indexOf(error) } : null);
      }
    }
  });
  it('reassembles the saved inventory, map and outcome from its own records', () => {
    const again = V.assemble(entries(saved.trials, saved.anchor), saved.run, C);
    for (const key of ['accuracy', 'survival', 'missing']) expect(again[key]).toEqual(saved[key]);
    expect(again.run.status).toBe(saved.run.status);
    expect(V.interpret(saved, C)).toEqual(saved.outcome);
    expect(saved.trials).toHaveLength(saved.run.completedTrajectories);
  });
  it('keeps saved outputs sign-symmetric and duplicated ruler cases identical', () => {
    const find = (t, part, level) =>
      saved.trials.find(
        (x) =>
          x.part === part &&
          x.level === level &&
          `${x.solver}/${x.factor}/${x.controls}` === `${t.solver}/${t.factor}/${t.controls}`,
      );
    const scalars = ['finite', 'failure', 'failureIndex', 'peakM', 'peakSlope', 'nonfiniteSlopes'];
    for (const t of saved.trials.filter((x) => x.level > 0)) {
      const mirror = find(t, t.part, -t.level);
      for (const k of scalars) expect(mirror[k]).toBe(t[k]);
      expect(mirror.final === -t.final).toBe(true);
      for (const k of t.samples ? ['raw', 'output'] : [])
        expect(
          t.samples[k].every((x, i) => mirror.samples[k][i] === (x === null ? null : -x)),
        ).toBe(true);
    }
    for (const t of saved.trials.filter((x) => x.part === 'accuracy')) {
      const twin = find(t, 'survival', t.level);
      for (const k of [...scalars, 'final', 'failureTime']) expect(twin[k]).toBe(t[k]);
    }
  });
});
