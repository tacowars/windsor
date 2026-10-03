/** Verification fixtures for windsor#250; not additional measurements. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { TAPE_BOUNDS } from '../../packages/engine/src/inserts/tapeConstants.ts';
import { recoverJournal } from '../../docs/research/2026-09-30-tape-conditioning/journal.mjs';
import * as V from '../../docs/research/2026-10-01-tape-shipped-probe/evidence.mjs';

const saved = JSON.parse(
  readFileSync(
    new URL('../../docs/research/2026-10-01-tape-shipped-probe/measurement.json', import.meta.url),
    'utf8',
  ),
);
const options = {
  table: V.SHIPPED,
  configurations: V.CONFIGURATIONS,
  steps: V.plan(),
};
const journalOf = (kind, rows) => rows.map((value) => ({ kind, value }));
const probeEntries = () => [
  ...journalOf('guard', saved.probeGuard),
  ...journalOf('slew', saved.probeSlew),
];
const clean = { expired: false, exitCode: 0, truncatedTail: null };

/** A synthetic four-instance offline repeat at `ms` per quantum, in the page's record shape. */
const quantumMs = (V.SHIPPED.quantumFrames / V.SHIPPED.rate) * 1000;
const repeat = (id, mode, ms, factor) => ({
  step: `offline/${id}/4/${mode}`,
  renderMs: (ms / quantumMs) * V.SHIPPED.program.seconds * 1000,
  reports: [{ resets: 0, factor }],
  outputNonfinite: 0,
});
const raw = (ms) => ({
  program: null,
  realtime: [],
  repeats: V.SHIPPED.modes.flatMap((mode) =>
    Array.from({ length: V.SHIPPED.repeats }, () => repeat('shipped/2x', mode, ms, 2)),
  ),
});

describe('Declared experiment', () => {
  it('has 2,520 (c) cells, 84 (e) cells, 8 offline cells and 4 real-time trials', () => {
    expect(V.guardCells()).toHaveLength(2520);
    expect(V.slewCells()).toHaveLength(84);
    const ids = [...V.guardCells(), ...V.slewCells()].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(V.PROBE.guard.drives).toEqual([-32, -16, 0, 16, 32]);
    expect(V.PROBE.guard.biases).toEqual([TAPE_BOUNDS.bias[0], 0, TAPE_BOUNDS.bias[1]]);
    const steps = V.plan();
    expect(steps.filter((s) => s.kind === 'offline')).toHaveLength(8);
    expect(steps.filter((s) => s.kind === 'realtime')).toHaveLength(4);
    expect(V.SHIPPED.edits.high).toBeCloseTo(-32 + 64 * 0.8, 12);
  });
});

describe('The (c) assertion', () => {
  it('fails on a synthetic reset and names the cell as a blocker', () => {
    const rows = saved.probeGuard.map((r, i) => (i === 7 ? { ...r, resets: 1 } : r));
    const assertion = V.guardAssertion(rows, rows.length);
    expect(assertion.state).toBe('fails');
    expect(assertion.blockers).toEqual([rows[7].id]);
    expect(V.guardAssertion(rows.slice(0, 10), rows.length).state).toBe('fails');
  });
  it('passes only with every cell recorded and none reset', () => {
    expect(V.guardAssertion(saved.probeGuard, 2520).state).toBe('passes');
    expect(V.guardAssertion(saved.probeGuard.slice(1), 2520).state).toBe('incomplete');
  });
});

describe('The (e) slew rates', () => {
  it('are reported as counts and rates, never gated', () => {
    const slew = saved.probeSlew.map((r) => ({ ...r, resets: 50, firstResetSeconds: 0.25 }));
    const report = V.assembleProbe(
      [...journalOf('guard', saved.probeGuard), ...journalOf('slew', slew)],
      clean,
    );
    expect(report.probeRun.status).toBe('complete');
    expect(report.probeAssertion.state).toBe('passes');
    for (const row of report.probeSlewRates) {
      expect(row.gated).toBe(false);
      expect(row.resets).toBe(50 * row.cells);
      expect(row.resetsPerSecondMean).toBe(5);
      expect(row.firstResetSeconds).toBe(0.25);
    }
  });
});

describe('Target rule', () => {
  it('passes a four-instance median at 1.33 ms per quantum and fails 1.34 ms', () => {
    const at = (ms) => V.costTables(raw(ms), options);
    expect(V.withinTarget(1.33, V.SHIPPED)).toBe(true);
    expect(
      at(1.33)
        .costCells.filter((c) => c.measured)
        .map((c) => c.verdict),
    ).toEqual(['within target', 'within target']);
    expect(at(1.34).costAssessments[0].mean).toBe('mean outside target');
    expect(at(1.33).costAssessments[0].mean).toBe('mean within target');
    expect(at(1.33).costAssessments[1].mean).toBe('not measured');
  });
  it('refuses a report whose DSP ran at another factor', () => {
    const wrong = raw(1);
    wrong.repeats[0] = repeat('shipped/2x', 'steady', 1, 4);
    expect(V.costTables(wrong, options).costCheck.factorsMatch).toBe(false);
  });
});

describe('An expired or interrupted run', () => {
  it('marks every missing cell of both parts', () => {
    const probe = V.assembleProbe(probeEntries().slice(0, 100), {
      expired: true,
      exitCode: null,
    });
    expect(probe.probeRun.status).toBe('incomplete');
    expect(probe.probeRun.completed).toEqual({ guard: 100, slew: 0 });
    expect(probe.probeMissing).toHaveLength(2520 + 84 - 100);
    expect(probe.probeAssertion.state).toBe('incomplete');
    const cost = V.assembleCost(
      journalOf('repeat', saved.costRepeats.slice(0, 7)),
      {
        expired: true,
      },
      saved.costSettings,
    );
    expect(cost.costRun.status).toBe('incomplete');
    expect(cost.costRun.completed).toEqual({ offline: 1, realtime: 0 });
    expect(cost.costMissing.offline).toHaveLength(7);
    expect(cost.costMissing.realtime).toHaveLength(4);
  });
  it('recovers an interrupted journal, keeping every whole record and the tail', () => {
    const lines = probeEntries()
      .slice(0, 30)
      .map((e) => JSON.stringify(e));
    const { entries, truncatedTail } = recoverJournal(`${lines.join('\n')}\n{"kind":"gua`);
    expect(truncatedTail).toBe('{"kind":"gua');
    const report = V.assembleProbe(entries, { ...clean, exitCode: null, truncatedTail });
    expect(report.probeRun.status).toBe('incomplete');
    expect(report.probeGuard).toEqual(saved.probeGuard.slice(0, 30));
  });
});

describe('Saved report', () => {
  it('declared the shipped experiment and ran it to completion', () => {
    expect(saved.probeSettings).toEqual(V.PROBE);
    expect(saved.costSettings).toEqual(options);
    expect(saved.probeRun.status).toBe('complete');
    expect(saved.costRun.status).toBe('complete');
    expect(saved.costProgram.sha256).toBe(V.SHIPPED.program.sha256);
    expect(saved.costCheck.hashMatches).toBe(true);
  });
  it('recomputes every table from its records', () => {
    const probe = V.probeTables(saved.probeGuard, saved.probeSlew, saved.probeSettings);
    for (const [key, value] of Object.entries(probe)) expect(value).toEqual(saved[key]);
    const cost = V.costTables(
      { program: saved.costProgram, repeats: saved.costRepeats, realtime: saved.costTrials },
      saved.costSettings,
    );
    for (const [key, value] of Object.entries(cost)) expect(value).toEqual(saved[key]);
  });
});
