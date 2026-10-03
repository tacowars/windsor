/** Verification fixtures for windsor#211; not additional browser measurements. */
// reads-by-path: docs/research/*-tape-*/**
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  COST,
  CONFIGURATIONS,
  plan,
} from '../../docs/research/2026-09-30-tape-browser-cost/costConstants.ts';
import {
  renderProgram,
  programHash,
  checkProgram,
  sine,
} from '../../docs/research/2026-09-30-tape-browser-cost/program.ts';
import { recoverJournal } from '../../docs/research/2026-09-30-tape-conditioning/journal.mjs';
import * as V from '../../docs/research/2026-09-30-tape-browser-cost/evidence.mjs';

const saved = JSON.parse(
  readFileSync(
    new URL('../../docs/research/2026-09-30-tape-browser-cost/measurement.json', import.meta.url),
    'utf8',
  ),
);
const settings = {
  table: saved.settings.cost,
  configurations: saved.settings.configurations,
  steps: saved.settings.steps,
};
const program = renderProgram();

/** A synthetic offline repeat and real-time trial, in the page's record shape. */
const repeat = (step, renderMs) => ({
  step,
  renderMs,
  reports: [{ resets: 0 }],
  outputNonfinite: 0,
});
const trial = (step, renderCapacity) => ({
  step,
  baseLatency: 0.005,
  renderCapacity,
  reports: Array.from({ length: 4 }, () => ({
    busyMs: 100,
    wallMs: 2000,
    peakMs: 1,
    underruns: 0,
    resets: 0,
    nonfinite: 0,
    batches: { wallMs: [171, 170], busyMs: [10, 12] },
  })),
});
/** Audio milliseconds for a four-instance cell at `ms` per quantum. */
const renderFor = (ms) => (ms / V.quantumMs()) * COST.program.seconds * 1000;
const fourCells = (id, ms, count = COST.repeats) =>
  COST.modes.flatMap((mode) =>
    Array.from({ length: count }, () => repeat(`offline/${id}/4/${mode}`, renderFor(ms))),
  );

describe('Declared experiment', () => {
  it('has seven configurations, 28 offline cells and 14 four-instance real-time trials', () => {
    const steps = plan();
    expect(CONFIGURATIONS).toHaveLength(7);
    expect(steps.filter((s) => s.kind === 'offline')).toHaveLength(28);
    const realtime = steps.filter((s) => s.kind === 'realtime');
    expect(realtime).toHaveLength(14);
    expect(realtime.every((s) => s.instances === 4)).toBe(true);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });
});

describe('Music program', () => {
  it('is deterministic and hashes to the recorded SHA-256', async () => {
    const again = renderProgram();
    expect(again.left.every((v, i) => Object.is(v, program.left[i]))).toBe(true);
    expect(again.right.every((v, i) => Object.is(v, program.right[i]))).toBe(true);
    expect(await programHash(program)).toBe(COST.program.sha256);
  });
  it('is exactly 960,000 frames at -6 dBFS peak, right one frame behind left', () => {
    const check = checkProgram(program);
    expect(check.frames).toBe(960000);
    expect(Math.abs(check.peakDb + 6)).toBeLessThanOrEqual(0.01);
    expect(check.passes).toBe(true);
    expect(program.right[0]).toBe(0);
    expect(program.right.subarray(1)).toEqual(program.left.subarray(0, -1));
    expect(Math.abs(sine(0.25) - 1)).toBeLessThan(6e-8);
    expect(COST.program.peakGain).toBeCloseTo(10 ** (COST.program.peakDbfs / 20), 15);
  });
  it('fails a 0.5 dB level error, and its hash changes', async () => {
    const gain = 10 ** (0.5 / 20);
    const loud = {
      left: program.left.map((v) => v * gain),
      right: program.right.map((v) => v * gain),
    };
    expect(checkProgram(loud).levelOk).toBe(false);
    expect(checkProgram(loud).passes).toBe(false);
    expect(await programHash(loud)).not.toBe(COST.program.sha256);
    expect(checkProgram({ left: program.left.subarray(1), right: program.right }).passes).toBe(
      false,
    );
  });
});

describe('Target rule', () => {
  const id = 'rk4/4x/48s';
  it('passes at 1.33 ms per quantum and fails at 1.34 ms', () => {
    expect(V.withinTarget(1.33)).toBe(true);
    expect(V.withinTarget(1.34)).toBe(false);
    const at = (ms) => V.assessMean(V.offlineCells(fourCells(id, ms)), id);
    expect(at(1.33)).toBe('mean within target');
    expect(at(1.34)).toBe('mean outside target');
  });
  it('calls a cell with fewer than five repeats not measured', () => {
    const cells = V.offlineCells(fourCells(id, 1, 4));
    const cell = cells.find((c) => c.id === `offline/${id}/4/steady`);
    expect(cell.repeats).toBe(4);
    expect(cell.measured).toBe(false);
    expect(V.assessMean(cells, id)).toBe('not measured');
  });
  it('cannot resolve peak without renderCapacity, or with an underrun', () => {
    const good = { available: true, intervalSeconds: 1, updates: [] };
    good.updates.push({ averageLoad: 0.2, peakLoad: 0.3, underrunRatio: 0 });
    const rows = (rc) => V.realtimeRows(COST.modes.map((m) => trial(`realtime/${id}/4/${m}`, rc)));
    expect(V.assessPeak(rows({ available: false, updates: [] }), id)).toEqual({
      state: 'unresolved',
      reason: 'renderCapacity absent',
    });
    expect(V.assessPeak(rows(good), id).state).toBe('resolved');
    const underrun = { ...good, updates: [{ ...good.updates[0], underrunRatio: 0.01 }] };
    expect(V.assessPeak(rows(underrun), id).state).toBe('unresolved');
    const row = rows(good).find((r) => r.configuration === id);
    expect(row.batched.wallMsPerQuantum.max).toBe(171 / 64);
    expect(row.batched.busyMsPerQuantum.max).toBe((4 * 12) / 64);
  });
});

describe('Saved report', () => {
  it('declared the shipped experiment and recomputes every table from its records', () => {
    expect(saved.settings.cost).toEqual(COST);
    expect(saved.settings.configurations).toEqual(CONFIGURATIONS);
    expect(saved.settings.steps).toEqual(plan());
    const derived = V.tables(saved, settings);
    for (const key of ['check', 'cells', 'realtimeTable', 'assessments', 'comparison', 'paths'])
      expect(derived[key]).toEqual(saved[key]);
  });
  it('names exactly one mean state per configuration and proves the program in the browser', () => {
    expect(saved.assessments).toHaveLength(7);
    for (const a of saved.assessments) expect(V.MEAN_STATES).toContain(a.mean);
    expect(saved.check.hashMatches).toBe(true);
    expect(saved.program.sha256).toBe(COST.program.sha256);
    expect(saved.run.scheduled).toEqual({ offline: 28, realtime: 14 });
  });
  it('recovers an interrupted journal as an explicit incomplete inventory', () => {
    const lines = [
      { kind: 'program', value: saved.program },
      ...saved.realtime.slice(0, 3).map((value) => ({ kind: 'realtime', value })),
      ...saved.repeats.slice(0, 7).map((value) => ({ kind: 'repeat', value })),
    ].map((e) => JSON.stringify(e));
    const { entries, truncatedTail } = recoverJournal(`${lines.join('\n')}\n{"kind":"rep`);
    const report = V.assemble(entries, { expired: true, truncatedTail }, settings);
    expect(truncatedTail).toBe('{"kind":"rep');
    expect(report.run.status).toBe('incomplete');
    expect(report.run.completed).toEqual({ offline: 1, realtime: 3 });
    expect(report.missing.offline).toHaveLength(27);
    expect(report.missing.realtime).toHaveLength(11);
    expect(report.repeats).toHaveLength(7);
    expect(report.assessments.every((a) => a.mean === 'not measured')).toBe(true);
    expect(report.paths.onePath).toBe('undetermined');
  });
});
