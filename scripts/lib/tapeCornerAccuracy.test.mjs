/** windsor#215: declared matrix, the span pairs, the candidate gate and the report contract. */
// reads-by-path: docs/research/*-tape-*/**
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  CORNER as T,
  CONDITIONING as K,
  EXPERIMENT as E,
  FILTERED as F,
  REFERENCE as R,
  cases,
} from '../../docs/research/2026-09-30-tape-corner-accuracy/cornerConstants.ts';
import {
  renderCandidate,
  spanField,
  spanKernel,
} from '../../docs/research/2026-09-30-tape-corner-accuracy/render.ts';
import {
  assemble,
  candidate,
  gateDb,
  outcome,
  verdict,
} from '../../docs/research/2026-09-30-tape-corner-accuracy/evidence.mjs';
import { target } from '../../docs/research/2026-09-30-tape-conditioning/evidence.mjs';
import { recoverJournal } from '../../docs/research/2026-09-30-tape-conditioning/journal.mjs';
import {
  renderConditioned,
  subgrid,
} from '../../docs/research/2026-09-30-tape-conditioning/conditioning.ts';
import {
  Field,
  kernel,
} from '../../docs/research/2026-09-30-tape-filtered-reference/reconstruction.ts';

const report = new URL(
  '../../docs/research/2026-09-30-tape-corner-accuracy/measurement.json',
  import.meta.url,
);
const rows = cases();
const row = (id) => rows.find((r) => r.id === id);
const [narrow2, wide2] = T.settings;
const render = (setting, r) =>
  renderCandidate({
    setting,
    signal: r,
    controls: r.controls,
    field:
      setting.span === 32
        ? subgrid(new Field(r.bins, 2 * setting.factor), setting.factor)
        : spanField(r.bins, 2 * setting.factor, setting.span),
  });
const qualified = { qualified: true, spectrum: null };
const passing = {
  gated: true,
  referenceQualified: true,
  state: { finite: true, resets: 0, clips: 0, failure: null, peak: 1 },
  sensitivityDb: 0,
};

describe('Declared matrix and gates', () => {
  it('schedules 108 reference cases, 432 candidates and 72 gated rows per setting', () => {
    expect(rows).toHaveLength(T.expected.references);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows.length * T.settings.length).toBe(T.expected.candidates);
    expect(rows.filter((r) => gateDb(r) !== null)).toHaveLength(T.expected.gatedPerSetting);
    expect(T.signals).toEqual([...E.bins.map((b) => [b]), R.twoToneBins]);
    expect(T.refinements).toEqual(K.refinements);
    expect(T.referenceSpan).toBe(E.firSpan);
  });
  it("keeps #167's reference margins and candidate gates unchanged", () => {
    expect(T.referenceGates).toEqual({
      lowMidDb: R.lowMidGateDb,
      highDb: R.highGateDb,
      settlingDb: R.settlingGateDb,
    });
    expect(T.candidateGates.sensitivityDb).toBe(R.sensitivityDb);
    expect(T.highBin).toBe(K.anchorBins.at(-1));
    for (const r of rows.filter((x) => x.amplitude !== T.edgeLevel))
      expect(gateDb(r)).toBe(target(r) + F.candidateMarginDb);
  });
  it('fails a value just past each threshold and leaves the edge level ungated', () => {
    for (const [id, gate] of [
      ['0.5:0.5:0.5/17/1', -60],
      ['0.5:0.5:0.5/173/0.25', -60],
      ['1:0:1/1361/1', -50],
      ['0:0:0/997+1361/0.25', -50],
    ]) {
      expect(gateDb(row(id))).toBe(gate);
      expect(verdict({ ...passing, threshold: gate, residualDb: gate })).toBe('pass');
      expect(verdict({ ...passing, threshold: gate, residualDb: gate + 1e-9 })).toBe('fail');
    }
    const sensitivity = { ...passing, threshold: -60, residualDb: -90 };
    expect(verdict({ ...sensitivity, sensitivityDb: 0.1 + 1e-9 })).toBe('fail');
    expect(gateDb(row('1:0:1/1361/4'))).toBeNull();
    expect(verdict({ ...passing, gated: false, residualDb: -300 })).toBe('ungated');
    const edge = { ...passing, gated: false, referenceQualified: false, residualDb: -300 };
    expect(verdict(edge)).toBe('no reference');
  });
});

describe('The span-32 and span-48 pairs', () => {
  it('generalises the continuous kernel and field bit for bit at span 32', () => {
    for (const t of [-16, -3.25, -1e-5, 0, 0.125, 7.5, 15.99])
      expect(spanKernel(t, 32)).toEqual(kernel(t));
    const bins = [997, 1361];
    const [mine, theirs] = [spanField(bins, 4, 32), new Field(bins, 4)];
    for (const i of [0, 1, 127, 128, 129, 5000, 32767, 32768, 40000, 70001])
      for (const d of [false, true]) expect(mine.at(i, d)).toBe(theirs.at(i, d));
  });
  it("reproduces #167's span-32 trajectory and distinguishes the symmetric span-48 pair", () => {
    const r = row('1:0:1/1361/1');
    const old = renderConditioned({
      rate: T.rate,
      factor: 2,
      signal: r,
      controls: r.controls,
      policy: 'knee',
      field: subgrid(new Field(r.bins, 4), 2),
    });
    const [a, b] = [render(narrow2, r), render(wide2, r)];
    expect(Array.from(a.raw)).toEqual(Array.from(old.raw));
    expect(a.output.every((y, n) => Math.abs(y - old.output[n]) < 1e-6)).toBe(true);
    expect([a.decimator, a.latency, a.taps]).toEqual(['existing', 32, 65]);
    expect([b.decimator, b.latency, b.taps]).toEqual(['symmetric', 48, 97]);
    expect(Math.max(a.interpolation, b.interpolation)).toBeLessThan(1e-6);
    const [ca, cb] = [candidate(a, a, r, qualified, narrow2), candidate(b, b, r, qualified, wide2)];
    expect([ca.setting, ca.decimator, ca.alignment.shift]).toEqual(['rk4/2x/32', 'existing', 0]);
    expect([cb.setting, cb.decimator, cb.alignment.shift]).toEqual(['rk4/2x/48s', 'symmetric', 16]);
    expect(ca.id).not.toBe(cb.id);
  });
});

describe('Candidate status', () => {
  const r = row('0.5:0.5:0.5/173/1');
  const a = render(narrow2, r);
  it('passes a clean self-comparison, never a reset or clipped render', () => {
    expect(candidate(a, a, r, qualified, narrow2).status).toBe('pass');
    for (const fault of [{ resets: 1 }, { clips: 1 }, { failure: 'Invalid reference state' }]) {
      const c = candidate({ ...a, ...fault }, a, r, qualified, narrow2);
      expect([c.status, c.passes]).toEqual(['fail', false]);
    }
  });
  it('marks a candidate against an unqualified reference "no reference"', () => {
    const c = candidate(a, a, r, { qualified: false, spectrum: null }, narrow2);
    expect([c.status, c.passes, c.residualDb]).toEqual(['no reference', false, -300]);
  });
});

describe('Inventory and report', () => {
  const r = rows[0];
  const ref = { ...r, qualified: true };
  const cand = (s, status) => ({
    id: `${r.id}@${s}`,
    case: r.id,
    status,
    residualDb: -70,
    threshold: -60,
  });
  it('marks every missing row of an expired run and passes none of them', () => {
    const entries = [
      { kind: 'reference', value: ref },
      { kind: 'candidate', value: cand('rk4/2x/32', 'pass') },
      { kind: 'candidate', value: cand('rk4/2x/48s', 'fail') },
    ];
    const run = { expired: true, exitCode: null, elapsedMs: 900000, truncatedTail: null };
    const out = assemble(entries, run);
    expect(out.run.status).toBe('incomplete');
    expect(out.missing.references).toHaveLength(107);
    expect(out.missing.candidates).toHaveLength(430);
    const [a, b, c] = out.outcome.settings;
    expect([a.passes, a.missing, a.meetsEverywhere]).toEqual([1, 71, false]);
    expect([b.passes, b.failing[0].status, c.passes, c.missing]).toEqual([0, 'fail', 0, 72]);
    expect(out.outcome.spanComparison[0].changed[0].case).toBe(r.id);
  });
  it('recovers an interrupted journal and keeps its truncated tail', () => {
    const line = JSON.stringify({ kind: 'reference', value: ref });
    const { entries, truncatedTail } = recoverJournal(`${line}\n{"kind":"candid`);
    expect([entries.length, truncatedTail]).toEqual([1, '{"kind":"candid']);
    const run = { expired: true, exitCode: null, elapsedMs: 1, truncatedTail };
    const out = assemble(entries, run);
    expect([out.run.truncatedTail, out.groups.length, out.counts.completedCandidates]).toEqual([
      truncatedTail,
      1,
      0,
    ]);
  });
  it.runIf(existsSync(report))(
    "recomputes the saved report's statuses, counts and worst rows",
    () => {
      const saved = JSON.parse(readFileSync(report, 'utf8'));
      for (const g of saved.groups) for (const c of g.candidates) expect(verdict(c)).toBe(c.status);
      expect(outcome(saved.groups)).toEqual(saved.outcome);
      const all = saved.groups.flatMap((g) => g.candidates);
      expect(saved.counts.completedCandidates).toBe(all.length);
      expect(saved.counts.completedReferences).toBe(saved.groups.length);
      expect(saved.counts.qualifiedReferences).toBe(saved.groups.filter((g) => g.qualified).length);
      if (saved.run.status === 'complete') expect(all).toHaveLength(T.expected.candidates);
    },
  );
});
