/* global structuredClone */
/** Verification fixtures for windsor#192; not additional reference experiments. */
// reads-by-path: docs/research/*-tape-*/**
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  EVENTS as E,
  cases,
} from '../../docs/research/2026-09-30-tape-event-alignment/eventConstants.ts';
import {
  classify,
  insertions,
  locate,
  renderAligned,
} from '../../docs/research/2026-09-30-tape-event-alignment/eventAlignment.ts';
import {
  pulseField,
  pulseInput,
  stage,
  subgrid,
} from '../../docs/research/2026-09-30-tape-conditioning/conditioning.ts';
import { reconstruct } from '../../docs/research/2026-09-30-tape-filtered-reference/reconstruction.ts';
import { renderBoundary } from '../../docs/research/2026-09-30-tape-boundary-reference/boundaryReference.ts';
import {
  anchor,
  assemble,
  errors,
  gate,
  interpret,
  ruler as rulerCheck,
  rulerRow,
} from '../../docs/research/2026-09-30-tape-event-alignment/evidence.mjs';
import { recoverJournal } from '../../docs/research/2026-09-30-tape-conditioning/journal.mjs';

const rows = cases(E);
const row = rows[0];
const input = pulseInput(row.level, 0);
const field = pulseField(row.level, 0, 128);
const at64 = subgrid(field, 64);
const observed = (r) => ({
  final: r.final,
  ...Object.fromEntries(['raw', 'output', 'fixed'].map((k) => [k, Array.from(r[k])])),
});

describe('Declared event-alignment matrix', () => {
  it('fixes two cases, five factors, two methods, the event rules, ruler and bound', () => {
    expect(E.levels).toEqual([64, 128, 256, 512, 1024]);
    expect(E.methods).toEqual(['fixed', 'aligned']);
    expect(E.kinds).toEqual(['fieldZero', 'knee', 'velocity']);
    expect([E.timeTolerance, E.mergeThreshold, E.tolerance, E.budgetMs]).toEqual([
      2 ** -40,
      2 ** -30,
      1e-7,
      900000,
    ]);
    expect(rows.map((r) => r.level)).toEqual([100, -100]);
    expect(E.ruler).toMatchObject({ factor: 8192, final: 1.694384147775507e-5 });
    const empty = assemble([], { expired: false, exitCode: 0, truncatedTail: null });
    expect(empty.run.scheduledTrajectories).toBe(20);
    expect(empty.missing).toHaveLength(20);
  });
});

describe('Continuous field and located events', () => {
  it('evaluates the kernel directly at uniform nodes to the cached grid value', () => {
    for (let i = 0; i <= 2 * 512 * 128; i += 97) {
      const [h, d] = reconstruct(i / 256, input);
      for (const [x, cached] of [
        [h, field.at(i)],
        [d, field.at(i, true)],
      ])
        expect(Math.abs(x - cached)).toBeLessThanOrEqual(E.nodeRelative * Math.abs(cached));
    }
  });
  it('locates each event as a true class change of the continuous field', () => {
    const events = locate({ field: at64, input, factor: 64 });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(classify(e.kind, reconstruct(e.lo, input))).not.toBe(
        classify(e.kind, reconstruct(e.hi, input)),
      );
      expect(e.width <= E.timeTolerance || e.bisections <= E.bisectionCap).toBe(true);
      expect(e.lo <= e.time && e.time <= e.hi).toBe(true);
    }
    const signChanges = events.filter((e) => e.kind === 'fieldZero' && e.from * e.to < 0);
    expect(
      signChanges.every((e) => reconstruct(e.lo, input)[0] * reconstruct(e.hi, input)[0] < 0),
    ).toBe(true);
  });
  it('merges near-coincident events, snaps node events and never moves a uniform node', () => {
    const t = 130.3;
    const found = insertions(
      [
        { time: t },
        { time: t + 2 ** -32 },
        { time: 131 / 64 },
        { time: 7 / 64 + 2 ** -35 },
        { time: t + 1e-3 },
      ],
      64,
    );
    expect([found.merged, found.atNode, found.inserted]).toEqual([1, 2, 2]);
    expect([...found.splits.keys()]).toEqual([Math.floor(t * 64)]);
    for (const [n, times] of found.splits)
      expect(times.every((x) => x > n / 64 && x < (n + 1) / 64)).toBe(true);
    const plain = renderAligned({ row, factor: 64, field: at64, frames: 140 });
    const split = renderAligned({
      row,
      factor: 64,
      field: at64,
      frames: 140,
      splits: found.splits,
    });
    expect(split.raw).toHaveLength(140);
    expect(Array.from(split.raw.slice(0, 131))).toEqual(Array.from(plain.raw.slice(0, 131)));
  });
});

describe('Aligned RK4 delegates to the imported stage arithmetic', () => {
  it('equals #183 fixed-step RK4 exactly with zero or node-only events', () => {
    const fixed = renderBoundary({ row, factor: 64, field: at64, instrument: false }, E);
    const none = renderAligned({ row, factor: 64, field: at64 });
    const nodes = insertions([{ time: 143 }, { time: 200.5 }], 64);
    expect(nodes.splits.size).toBe(0);
    expect(observed(none)).toEqual(observed(fixed));
  });
  it('reproduces 128x at every node when each 64x step is split at its midpoint', () => {
    const frames = 160,
      mids = Array.from({ length: frames * 64 }, (_, n) => ({ time: (n + 0.5) / 64 }));
    const { splits } = insertions(mids, 64);
    const fine = renderAligned({ row, factor: 128, field, frames });
    const render = (points) =>
      renderAligned({ row, factor: 64, field: at64, frames, splits, points });
    expect(Array.from(render().raw)).toEqual(Array.from(fine.raw));
    const at = (t, chain) => {
      const [h, d] = reconstruct(t, input);
      const [ch, cd] = stage(h, E.rate * d, E.policy);
      return [ch, chain ? cd : E.rate * d];
    };
    const build = (times, chain) => (a, b) => times(a, b).flatMap((t) => at(t, chain));
    const noChain = build((a, b) => [a, (a + b) / 2, b], false);
    const noMidpoint = build((a, b) => [a, a, b], true);
    expect(Array.from(render(build((a, b) => [a, (a + b) / 2, b], true)).raw)).toEqual(
      Array.from(fine.raw),
    );
    for (const wrong of [noChain, noMidpoint])
      expect(Array.from(render(wrong).raw)).not.toEqual(Array.from(fine.raw));
  }, 30000);
});

const zeros = () => Array(E.frames).fill(0);
const synthetic = (r, factor, method, max = 0) => ({
  id: r.id,
  factor,
  method,
  state: { finite: true, failure: null, resets: 0, clips: 0, final: 0 },
  samples: { raw: zeros(), output: zeros(), fixed: zeros() },
  diagnostics: {
    records: { irreversible: [], series: [] },
    truncated: { irreversible: 0, series: 0 },
  },
  errors: Object.fromEntries(
    ['raw', 'output', 'fixed'].map((k) => [k, { max, frame: 143, probe: max }]),
  ),
});
const all = (max = 0) =>
  E.levels.flatMap((f) => rows.flatMap((r) => E.methods.map((m) => synthetic(r, f, m, max))));
const report = (trials, over = {}) => ({
  run: { status: 'complete' },
  anchor: { matches: true },
  ruler: { matches: true },
  trials,
  ...over,
});
const set = (trials, test, change) => trials.map((t) => (test(t) ? change(structuredClone(t)) : t));
const fail =
  (factors, keys = ['raw', 'output']) =>
  (t) => {
    if (factors.includes(t.factor)) for (const k of keys) t.errors[k].max = 1e-6;
    return t;
  };
const q = (r) => gate(r, 'fixed').qualifying;

describe('Cheaper-reference gate', () => {
  it('qualifies F only when F and 2F pass raw and full for both cases', () => {
    expect(q(report(all()))).toEqual([64, 128, 256, 512]);
    expect(gate(report(all()), 'fixed').cheapest).toBe(64);
    for (const keys of [['raw'], ['output']])
      expect(q(report(set(all(), () => true, fail(E.levels, keys))))).toEqual([]);
    expect(q(report(set(all(), () => true, fail([64, 128, 256, 512]))))).toEqual([]);
    expect(q(report(set(all(), () => true, fail([128, 512, 1024]))))).toEqual([]);
    expect(q(report(set(all(), (t) => t.id === rows[1].id, fail([64]))))).toEqual([128, 256, 512]);
  });
  it('fails on a missing 2F row, invalid state, an expired run or a failed anchor', () => {
    const missing = all().filter((t) => !(t.factor === 128 && t.id === rows[1].id));
    expect(q(report(missing))).toEqual([256, 512]);
    for (const state of [{ finite: false }, { resets: 1 }, { clips: 1 }]) {
      const bad = set(
        all(),
        (t) => t.factor === 256,
        (t) => ({ ...t, state: { ...t.state, ...state } }),
      );
      expect(q(report(bad))).toEqual([64, 512]);
    }
    expect(q(report(all(), { run: { status: 'incomplete' } }))).toEqual([]);
    expect(q(report(all(), { anchor: { matches: false } }))).toEqual([]);
    expect(q(report(all(), { ruler: { matches: false } }))).toEqual([]);
  });
  it('never lets fixed-8x observation qualify a failing full output', () => {
    const t = set(
      all(),
      () => true,
      (x) => ({ ...x, errors: { ...x.errors, output: { ...x.errors.output, max: 1e-6 } } }),
    );
    expect(q(report(t))).toEqual([]);
  });
  it('classifies exactly one outcome from gates, orders and residual location', () => {
    /** Errors k * (64/F)^order for one method, every observation. */
    const curve = (trials, method, k, order) =>
      set(
        trials,
        (t) => t.method === method,
        (t) => {
          for (const e of Object.values(t.errors)) e.max = k * (64 / t.factor) ** order;
          return t;
        },
      );
    const base = curve(all(), 'fixed', 1e-5, 1);
    expect(interpret(report(curve(base, 'aligned', 1e-5, 1))).outcome).toBe('c');
    const helped = curve(base, 'aligned', 1e-6, 1);
    expect(interpret(report(helped))).toMatchObject({ material: true, outcome: 'c' });
    const at = set(
      helped,
      (t) => t.method === 'aligned',
      (t) => {
        t.diagnostics.records.irreversible.push({ step: 143 * t.factor - 1, stage: 2 });
        return t;
      },
    );
    expect(interpret(report(at))).toMatchObject({ atSwitches: true, outcome: 'b' });
    const cheap = interpret(report(curve(at, 'aligned', 1e-9, 2)));
    expect(cheap.gates.aligned.cheapest).toBe(64);
    expect(cheap.outcome).toBe('a');
  });
});

describe('Interrupted journal', () => {
  it('recovers completed records, keeps the partial tail and qualifies nothing', () => {
    const lines = all()
      .slice(0, 7)
      .map((value) => JSON.stringify({ kind: 'trial', value }));
    const text = `${lines.join('\n')}\n{"kind":"tri`;
    const { entries, truncatedTail } = recoverJournal(text);
    const r = assemble(entries, {
      expired: true,
      exitCode: null,
      elapsedMs: 900000,
      truncatedTail,
    });
    expect(r.run).toMatchObject({
      status: 'incomplete',
      truncatedTail: '{"kind":"tri',
      completedTrajectories: 7,
    });
    expect(r.missing).toHaveLength(13);
    expect(r.outcome.gates.fixed.qualifying).toEqual([]);
    expect(r.outcome.gates.aligned.qualifying).toEqual([]);
  });
});

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const report$ = '../../docs/research/2026-09-30-tape-event-alignment/measurement.json';
describe.skipIf(!existsSync(new URL(report$, import.meta.url)))('Saved report', () => {
  it('recomputes every error, the anchor, the event counts and the outcome from saved rows', () => {
    const saved = read(report$);
    const ruler = read('../../docs/research/2026-09-30-tape-overload-reference/measurement.json');
    expect(saved.settings.events).toEqual(E);
    expect(saved.run.expired || saved.run.elapsedMs <= E.budgetMs).toBe(true);
    expect(rulerCheck(ruler, E.ruler.sha256)).toEqual(saved.ruler);
    expect(anchor(saved.trials, ruler)).toEqual(saved.anchor);
    expect([saved.ruler.matches, saved.anchor.matches]).toEqual([true, true]);
    for (const t of saved.trials) expect(errors(t, rulerRow(ruler, t.id))).toEqual(t.errors);
    for (const e of saved.events) expect(e.events.every((x) => x.from !== x.to)).toBe(true);
    const again = assemble(
      [
        { kind: 'ruler', value: saved.ruler },
        { kind: 'anchor', value: saved.anchor },
        ...saved.events.map((value) => ({ kind: 'events', value })),
        ...saved.trials.map((value) => ({ kind: 'trial', value })),
      ],
      Object.fromEntries(
        ['expired', 'exitCode', 'elapsedMs', 'truncatedTail'].map((k) => [k, saved.run[k]]),
      ),
    );
    for (const key of ['run', 'missing', 'eventCounts', 'outcome', 'orders'])
      expect(again[key]).toEqual(saved[key]);
  });
});
