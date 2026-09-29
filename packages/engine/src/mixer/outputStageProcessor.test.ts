/**
 * The generated output stage processor (windsor#93), run without a browser:
 * its parameters, its report on a hot fixture and a quiet one, a live change
 * of settings, and its shutdown.
 */
import { describe, expect, it } from 'vitest';

import {
  BLOCK,
  loadOutputStage,
  renderStage,
  stageParams,
} from '../__fixtures__/outputStageHarness';
import {
  OUTPUT_CEILING_DB,
  OUTPUT_STAGE_MODES,
  OUTPUT_STAGE_REPORT_HZ,
} from './outputStageConstants';
import { dbToGain } from './outputStageDsp';

const RATE = 48000;

/** One second of a 200 Hz sine at `peak`, and the right at half of it. */
function sine(peak: number, seconds = 1): [Float32Array, Float32Array] {
  const frames = Math.round(seconds * RATE);
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    l[i] = peak * Math.sin((2 * Math.PI * 200 * i) / RATE);
    r[i] = l[i]! / 2;
  }
  return [l, r];
}

describe('the output stage processor', () => {
  it('declares its three k-rate parameters with the defaults a new song starts on', () => {
    const { descriptors } = loadOutputStage(RATE);
    expect(descriptors).toEqual([
      expect.objectContaining({ name: 'mode', minValue: 0, maxValue: 3, defaultValue: 0 }),
      expect.objectContaining({
        name: 'ceilingDb',
        minValue: OUTPUT_CEILING_DB.min,
        maxValue: OUTPUT_CEILING_DB.max,
        defaultValue: -1,
      }),
      expect.objectContaining({ name: 'lookahead', minValue: 0, maxValue: 1, defaultValue: 0 }),
    ]);
    expect(OUTPUT_STAGE_MODES[0]).toBe('limiter');
  });

  it(`reports ${OUTPUT_STAGE_REPORT_HZ} times a second, whether or not anything listens`, () => {
    const [l, r] = sine(0.1);
    const { reports } = renderStage({ mode: 'limiter' }, l, r);
    const perReport = Math.ceil(RATE / OUTPUT_STAGE_REPORT_HZ / BLOCK);
    expect(reports).toHaveLength(Math.floor(RATE / BLOCK / perReport));
    for (const report of reports) {
      expect(Object.keys(report).sort()).toEqual(
        [
          'active',
          'inputLeft',
          'inputRight',
          'outputLeft',
          'outputRight',
          'overDb',
          'reductionDb',
          'type',
        ].sort(),
      );
    }
  });

  it('shows gain reduction on a hot fixture through the limiter, and nothing on a quiet one', () => {
    const [hotL, hotR] = sine(dbToGain(-1 + 9));
    const hot = renderStage({ mode: 'limiter', lookahead: true }, hotL, hotR).reports.at(-1)!;
    expect(hot.reductionDb).toBeCloseTo(9, 1);
    expect(hot.overDb).toBe(0);
    expect(hot.active).toBe(true);
    expect(hot.inputLeft).toBeCloseTo(dbToGain(8), 3);
    expect(hot.inputRight).toBeCloseTo(dbToGain(8) / 2, 3);
    expect(hot.outputLeft).toBeLessThanOrEqual(Math.fround(dbToGain(-1)));
    const [quietL, quietR] = sine(0.5);
    const quiet = renderStage({ mode: 'limiter' }, quietL, quietR).reports.at(-1)!;
    expect(quiet).toMatchObject({ reductionDb: 0, overDb: 0, active: false });
    expect(quiet.outputLeft).toBeCloseTo(0.5, 3);
  });

  it('shows the amount over the ceiling through the clippers', () => {
    const [l, r] = sine(dbToGain(-3 + 6));
    for (const mode of ['soft', 'hard'] as const) {
      const report = renderStage({ mode, ceilingDb: -3 }, l, r).reports.at(-1)!;
      expect(report.overDb).toBeCloseTo(6, 2);
      expect(report.reductionDb).toBe(0);
      expect(report.active).toBe(true);
      expect(report.outputLeft).toBeLessThanOrEqual(Math.fround(dbToGain(-3)));
    }
  });

  it('passes the input through Off and still reports overs past full scale', () => {
    const [l, r] = sine(1.6);
    const out = renderStage({ mode: 'off' }, l, r);
    expect(out.left).toEqual(l);
    expect(out.right).toEqual(r);
    const report = out.reports.at(-1)!;
    expect(report.outputLeft).toBeGreaterThan(1.59);
    expect(report).toMatchObject({ reductionDb: 0, overDb: 0, active: false });
  });

  it('takes a new mode and ceiling from its parameters mid-stream', () => {
    const [l, r] = sine(2);
    const half = Math.round(RATE / 2 / BLOCK);
    const out = renderStage({ mode: 'off' }, l, r, {
      retune: (block) => (block === half ? { mode: 'hard', ceilingDb: -6 } : null),
    });
    const before = out.left.subarray(0, half * BLOCK);
    const after = out.left.subarray(half * BLOCK);
    expect(Math.max(...before)).toBeGreaterThan(1.9);
    expect(Math.max(...after)).toBeLessThanOrEqual(Math.fround(dbToGain(-6)));
  });

  it('renders silence for a missing input, and stops for good on "stop"', () => {
    const processor = loadOutputStage(RATE).create();
    const out = [new Float32Array(BLOCK).fill(9), new Float32Array(BLOCK).fill(9)];
    expect(processor.process([[]], [out], stageParams({ mode: 'hard' }))).toBe(true);
    expect(out[0]!.every((v) => v === 0)).toBe(true);
    processor.inbox({ type: 'stop' });
    expect(processor.process([[]], [out], stageParams({ mode: 'hard' }))).toBe(false);
  });
});
