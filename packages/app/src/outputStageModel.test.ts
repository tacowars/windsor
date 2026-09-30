import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MASTER,
  DEFAULT_OUTPUT_STAGE,
  OUTPUT_CEILING_DB,
  OUTPUT_STAGE_MODES,
  PEAK_METER,
} from '@windsor/engine';
import type { OutputStageReport } from '@windsor/engine';
import {
  EMPTY_HOLD,
  gaugeDb,
  gaugeFor,
  lookaheadEnabled,
  meterView,
  outputEdit,
  outputLight,
  peakDb,
  peakLabel,
  reportAction,
  reportActed,
  stepHold,
} from './outputStageModel';
import {
  OUTPUT_CEILING_KNOB,
  OUTPUT_GAUGE_MAX_DB,
  OUTPUT_LIGHT_HOLD_MS,
  OUTPUT_MODE_LABELS,
} from './outputStageTables';

const report = (over: Partial<OutputStageReport> = {}): OutputStageReport => ({
  type: 'outputStage',
  inputLeft: 0,
  inputRight: 0,
  outputLeft: 0,
  outputRight: 0,
  reductionDb: 0,
  overDb: 0,
  active: false,
  ...over,
});

describe('the output stage controls', () => {
  it('read the engine range and default', () => {
    expect(OUTPUT_CEILING_KNOB.min).toBe(OUTPUT_CEILING_DB.min);
    expect(OUTPUT_CEILING_KNOB.max).toBe(OUTPUT_CEILING_DB.max);
    expect(OUTPUT_CEILING_KNOB.def).toBe(DEFAULT_OUTPUT_STAGE.ceilingDb);
    expect(OUTPUT_STAGE_MODES.map((mode) => OUTPUT_MODE_LABELS[mode])).toEqual([
      'Limiter',
      'Soft clip',
      'Hard clip',
      'Off',
    ]);
  });

  it('write the whole output over the settings in force', () => {
    expect(outputEdit(undefined, { mode: 'soft' })).toEqual({
      master: { output: { ...DEFAULT_OUTPUT_STAGE, mode: 'soft' } },
    });
    const master = {
      ...DEFAULT_MASTER,
      output: { mode: 'limiter', ceilingDb: -3, lookahead: true },
    } as const;
    expect(outputEdit(master, { mode: 'hard' }).master.output).toEqual({
      mode: 'hard',
      ceilingDb: -3,
      lookahead: true,
    });
    expect(outputEdit(master, { ceilingDb: -6 }).master.output.ceilingDb).toBe(-6);
  });

  it('enable Lookahead in Limiter mode only, keeping its value', () => {
    expect(OUTPUT_STAGE_MODES.filter(lookaheadEnabled)).toEqual(['limiter']);
    const master = {
      ...DEFAULT_MASTER,
      output: { mode: 'limiter', ceilingDb: -1, lookahead: true },
    } as const;
    const soft = outputEdit(master, { mode: 'soft' }).master;
    expect(soft.output.lookahead).toBe(true);
    const back = outputEdit({ ...master, ...soft }, { mode: 'limiter' });
    expect(back.master.output.lookahead).toBe(true);
  });
});

describe('the meter scale', () => {
  it('clamps a peak to the floor and the ceiling', () => {
    expect(peakDb(0)).toBe(PEAK_METER.floorDb);
    expect(peakDb(1e-9)).toBe(PEAK_METER.floorDb);
    expect(peakDb(1)).toBe(0);
    expect(peakDb(100)).toBe(PEAK_METER.ceilingDb);
    expect(peakDb(0.5)).toBeCloseTo(-6.02, 2);
  });

  it('clamps a gauge reading to 0 .. its full scale', () => {
    expect(gaugeDb(0)).toBe(0);
    expect(gaugeDb(-1)).toBe(0);
    expect(gaugeDb(Number.NaN)).toBe(0);
    expect(gaugeDb(3.5)).toBe(3.5);
    expect(gaugeDb(OUTPUT_GAUGE_MAX_DB + 10)).toBe(OUTPUT_GAUGE_MAX_DB);
  });

  it('shows gain reduction for the limiter, the excess for the clippers, none in Off', () => {
    expect(OUTPUT_STAGE_MODES.map(gaugeFor)).toEqual(['reduction', 'over', 'over', 'none']);
    const hot = report({ inputLeft: 2, outputLeft: 0.89, reductionDb: 7, overDb: 5, active: true });
    expect(meterView(hot, 'limiter').gaugeDb).toBe(7);
    expect(meterView(hot, 'soft').gaugeDb).toBe(5);
    expect(meterView(hot, 'hard').gaugeDb).toBe(5);
    expect(meterView(hot, 'off').gaugeDb).toBe(0);
  });

  it('reads a quiet song as matching peaks and an empty gauge', () => {
    const quiet = report({ inputLeft: 0.25, inputRight: 0.2, outputLeft: 0.25, outputRight: 0.2 });
    const view = meterView(quiet, 'limiter');
    expect(view.peaks[0]).toBe(view.peaks[2]);
    expect(view.peaks[1]).toBe(view.peaks[3]);
    expect(view.gaugeDb).toBe(0);
    expect(reportActed(quiet)).toBe(false);
  });

  it('draws idle as the floor and an empty gauge', () => {
    const idle = meterView(null, 'limiter');
    expect(idle.peaks).toEqual([
      PEAK_METER.floorDb,
      PEAK_METER.floorDb,
      PEAK_METER.floorDb,
      PEAK_METER.floorDb,
    ]);
    expect(idle.gaugeDb).toBe(0);
  });

  it('labels a peak in dBFS, silence as −∞', () => {
    expect(peakLabel(0)).toBe('−∞ dBFS');
    expect(peakLabel(1)).toBe('0.0 dBFS');
    expect(peakLabel(0.5)).toBe('-6.0 dBFS');
  });
});

describe('the clip light', () => {
  it('latches when the stage changed a sample', () => {
    expect(reportActed(report({ active: true }))).toBe(true);
    expect(reportActed(report({ inputLeft: 0.9, outputLeft: 0.9 }))).toBe(false);
  });

  it('latches on an output sample above 0 dBFS, which only Off lets through', () => {
    expect(reportActed(report({ outputRight: 1.01 }))).toBe(true);
    expect(reportActed(report({ outputLeft: 1 }))).toBe(false);
  });

  it('names the action from the report alone: Limiting, Clipping, then Over 0 dB', () => {
    const limited = report({ inputLeft: 2, outputLeft: 0.89, reductionDb: 7, active: true });
    expect(reportAction(limited)).toBe('Limiting');
    expect(reportAction(report({ inputLeft: 2, outputLeft: 0.89, overDb: 7, active: true }))).toBe(
      'Clipping',
    );
    expect(reportAction(report({ inputRight: 1.2, outputRight: 1.2 }))).toBe('Over 0 dB');
    expect(reportAction(report({ inputLeft: 0.9, outputLeft: 0.9 }))).toBeNull();
    expect(reportAction(report({ outputLeft: 1 }))).toBeNull();
  });
});

describe('a held readout', () => {
  it('keeps the highest value for the hold, then follows', () => {
    let hold = stepHold(EMPTY_HOLD, 0.8, 0, 1000);
    expect(hold).toEqual({ value: 0.8, atMs: 0 });
    hold = stepHold(hold, 0.3, 500, 1000);
    expect(hold.value).toBe(0.8);
    hold = stepHold(hold, 0.9, 600, 1000);
    expect(hold).toEqual({ value: 0.9, atMs: 600 });
    hold = stepHold(hold, 0.3, 1599, 1000);
    expect(hold.value).toBe(0.9);
    expect(stepHold(hold, 0.3, 1600, 1000)).toEqual({ value: 0.3, atMs: 1600 });
  });
});

describe('the top-bar light', () => {
  it('holds for the peak meter hold after the stage acts', () => {
    expect(OUTPUT_LIGHT_HOLD_MS).toBe(PEAK_METER.holdSeconds * 1000);
    expect(outputLight('limiter', null, 5000).state).toBe('unlit');
    expect(outputLight('limiter', 1000, 1000).state).toBe('lit');
    expect(outputLight('limiter', 1000, 1000 + OUTPUT_LIGHT_HOLD_MS - 1).state).toBe('lit');
    expect(outputLight('limiter', 1000, 1000 + OUTPUT_LIGHT_HOLD_MS).state).toBe('unlit');
  });

  it('names the mode, and shows Off as outlined whatever happened', () => {
    expect(outputLight('limiter', 0, 0).title).toBe('Output: Limiter');
    expect(outputLight('soft', 0, 0).title).toBe('Output: Soft clip');
    expect(outputLight('hard', 0, 0).title).toBe('Output: Hard clip');
    expect(outputLight('off', 0, 0)).toEqual({ state: 'off', title: 'Output: Off' });
  });
});
