/** Verification fixtures for windsor#207; not additional resampler measurements. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { RESAMPLER as R } from '../../docs/research/2026-09-30-tape-resampler/resamplerConstants.ts';
import {
  dft,
  dtft,
  abs,
  db,
  symmetry,
  images,
  impulseResponses,
  measureFilter,
} from '../../docs/research/2026-09-30-tape-resampler/response.ts';
import { compareDecimators } from '../../docs/research/2026-09-30-tape-resampler/symmetric.ts';
import { coefficients } from '../../docs/research/2026-09-30-tape-phase-3/resampler.ts';
import { recoverJournal } from '../../docs/research/2026-09-30-tape-conditioning/journal.mjs';
import * as V from '../../docs/research/2026-09-30-tape-resampler/evidence.mjs';

const saved = JSON.parse(
  readFileSync(
    new URL('../../docs/research/2026-09-30-tape-resampler/measurement.json', import.meta.url),
    'utf8',
  ),
);
/** Independent DTFT magnitude, written out here rather than imported. */
const magnitude = (taps, f) => {
  let re = 0,
    im = 0;
  taps.forEach((h, n) => {
    re += h * Math.cos(2 * Math.PI * f * n);
    im += h * Math.sin(2 * Math.PI * f * n);
  });
  return Math.hypot(re, im);
};

describe('Spectral arithmetic', () => {
  it('reads a known coherent tone and DC, and matches the DTFT at a bin', () => {
    const n = 16,
      x = Array.from(
        { length: n },
        (_, i) => 0.5 * Math.cos((2 * Math.PI * 3 * i) / n + 0.3) + 0.25,
      );
    const [dc, , , tone] = dft(x, 0, 3);
    expect(dc[0]).toBeCloseTo(0.25, 14);
    expect(abs(tone)).toBeCloseTo(0.5, 14);
    expect(Math.atan2(tone[1], tone[0])).toBeCloseTo(0.3, 14);
    const [re, im] = dtft(x, 3 / n);
    expect((2 * re) / n).toBeCloseTo(tone[0], 14);
    expect((2 * im) / n).toBeCloseTo(tone[1], 14);
    expect(abs(dft(x, 5)[0])).toBeLessThan(1e-15);
  });
});

describe('Coefficient and delay checks', () => {
  it('fails a deliberately asymmetric tap set and a non-unit sum', () => {
    const taps = Float64Array.from(coefficients(2, 16));
    expect(symmetry(taps).symmetric).toBe(true);
    expect(symmetry(taps).unitSum).toBe(true);
    taps[0] += 1e-12;
    expect(symmetry(taps).symmetric).toBe(false);
    taps[0] -= 1e-12;
    taps[16] += 1e-12;
    expect(symmetry(taps).unitSum).toBe(false);
  });
  it('captures both FIRs through the class and puts the cascade peak at span', () => {
    const ir = impulseResponses({ factor: 4, span: 8 });
    expect(Array.from(ir.interpolator)).toEqual(Array.from(coefficients(4, 8)));
    expect(Array.from(ir.decimator)).toEqual(Array.from(coefficients(4, 8)));
    expect(ir.cascade.indexOf(Math.max(...ir.cascade))).toBe(8);
  });
});

describe('Image measurement', () => {
  it('measures a span-4 filter at its independently computed image level', () => {
    const taps = coefficients(2, 4),
      [result] = images({ factor: 2, span: 4 }, taps, { ...R, tones: [0.45] });
    const expected = 20 * Math.log10(magnitude(taps, 0.55 / 2) / magnitude(taps, 0.45 / 2));
    expect(result.toneImage).toBeCloseTo(0.55, 12);
    expect(result.toneDb).toBeCloseTo(expected, 6);
    expect(result.irDb).toBeCloseTo(expected, 6);
    expect(expected).toBeGreaterThan(-30);
    expect(V.levelPasses(result.toneDb)).toBe(false);
  });
  it('agrees by both methods on a small filter', () => {
    const table = { ...R, tones: [0.2, 0.45], passbandTones: 8, edgeFrames: 1024, grid: 16 };
    const record = measureFilter({ factor: 2, span: 8 }, table);
    expect(V.agreement(record, table).agrees).toBe(true);
    expect(record.ir.cascade.matches).toBe(true);
    expect(db(0)).toBe(-300);
  });
});

describe('Symmetric decimator', () => {
  const table = { ...R, equivalence: { ...R.equivalence, frames: 2048 } };
  it('fails the equivalence test with a deliberately wrong centre tap', () => {
    const right = compareDecimators({ factor: 2, span: 16 }, table);
    const wrong = compareDecimators({ factor: 2, span: 16 }, table, (d) => (d.centre += 1e-9));
    expect(right.symmetricError).toBeLessThan(1e-15);
    expect(wrong.passes).toBe(false);
    expect(wrong.symmetricError).toBeGreaterThan(1e-11);
    expect(wrong.maxDifference).toBeGreaterThan(1e4 * right.maxDifference);
  });
});

describe('Declared figures', () => {
  it('fail just past each threshold', () => {
    expect(V.levelPasses(R.levelTargetDb)).toBe(true);
    expect(V.levelPasses(R.levelTargetDb + 1e-9)).toBe(false);
    expect(V.passbandPasses(R.passbandTargetDb)).toBe(true);
    expect(V.passbandPasses(R.passbandTargetDb + 1e-9)).toBe(false);
  });
});

describe('Saved report', () => {
  it('recomputes its tables from its records', () => {
    const { filterTable, equivalenceTable, costTable, outcome } = V.tables(saved);
    expect(filterTable).toEqual(saved.filterTable);
    expect(equivalenceTable).toEqual(saved.equivalenceTable);
    expect(costTable).toEqual(saved.costTable);
    expect(outcome).toEqual(saved.outcome);
  });
  it('is complete, with a delay of span and checked coefficients at every sweep point', () => {
    expect(saved.run.status).toBe('complete');
    expect(saved.filterTable).toHaveLength(15);
    for (const row of saved.filterTable) {
      expect(row.delayMatches).toBe(true);
      expect(row.delay).toBeCloseTo(row.span, 9);
      expect(row.coefficients).toBe(true);
    }
    for (const point of saved.equivalence)
      expect(point.symmetricError).toBeLessThanOrEqual(point.existingError);
  });
  it('recovers an interrupted journal as an explicit incomplete inventory', () => {
    const lines = [
      ...saved.filters.slice(0, 2).map((value) => ({ kind: 'filter', value })),
      { kind: 'round', value: saved.benchmarks[0] },
    ].map((e) => JSON.stringify(e));
    const text = `${lines.join('\n')}\n{"kind":"equivalence","val`;
    const { entries, truncatedTail } = recoverJournal(text);
    const report = V.assemble(entries, { expired: true, exitCode: null, truncatedTail });
    expect(truncatedTail).toBe('{"kind":"equivalence","val');
    expect(report.run.status).toBe('incomplete');
    expect(report.filters).toHaveLength(2);
    expect(report.missing.filters).toHaveLength(13);
    expect(report.missing.equivalence).toHaveLength(15);
    expect(report.missing.benchmarks).toHaveLength(6);
    expect(report.benchmarks).toHaveLength(1);
    expect(report.costTable.every((row) => row.firShare === null)).toBe(true);
  });
});
