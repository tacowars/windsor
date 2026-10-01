import { describe, expect, it } from 'vitest';
import { RETURN_NAMES } from '../mixer/mix';
import { STEP_MOD_TABLE } from '../worklet/fm/stepModTables';
import {
  AUTOMATION_LEVEL_FLOOR_DB,
  FM_LANES_MAX,
  STRIP_AUTOMATION_ROWS,
  VOICE_AUTOMATION_ROWS,
} from './automationTargetTables';

const OPERATOR_FIELDS = ['level', 'env.decayTime', 'env.decayCurve', 'feedback', 'width'];

const VOICE_IDS = [
  'voice.filter.cutoff',
  'voice.filter.envAmount',
  'voice.filter.resonance',
  'voice.filter.env.decayTime',
  ...[0, 1, 2, 3].flatMap((i) => OPERATOR_FIELDS.map((f) => `voice.ops.${i}.${f}`)),
  'voice.lfo.amount',
  'voice.lfo.rate',
  'voice.lfo2.amount',
  'voice.lfo2.rate',
  'voice.pitchEnvAmount',
];

describe('the voice rows', () => {
  it('are exactly the 29 targets of decision 2', () => {
    expect(VOICE_AUTOMATION_ROWS).toHaveLength(29);
    expect(VOICE_AUTOMATION_ROWS.map((r) => r.target)).toEqual(VOICE_IDS);
    expect(new Set(VOICE_AUTOMATION_ROWS.map((r) => r.label)).size).toBe(29);
  });

  it('take the step-mod table bounds, a decay time from 0 with its minimum as the floor', () => {
    for (const step of STEP_MOD_TABLE) {
      const row = VOICE_AUTOMATION_ROWS.find((r) => r.target === `voice.${step.param}`)!;
      expect(row.max, step.param).toBe(step.max);
      if (step.param.endsWith('decayTime')) {
        expect(row.min).toBe(0);
        expect(row.floor).toBe(step.min);
        expect(row.scale).toBe('log');
      } else {
        expect(row.min, step.param).toBe(step.min);
        expect(row.floor).toBeUndefined();
      }
    }
  });

  it('give every logarithmic row a positive bottom', () => {
    for (const row of VOICE_AUTOMATION_ROWS) {
      expect(row.min, row.target).toBeLessThan(row.max);
      if (row.scale !== 'linear') expect(row.floor ?? row.min, row.target).toBeGreaterThan(0);
    }
  });

  it('caps a part at 8 FM lanes', () => {
    expect(FM_LANES_MAX).toBe(8);
  });
});

describe('the strip rows', () => {
  it('are level, pan and a send per bus', () => {
    expect(STRIP_AUTOMATION_ROWS.map((r) => r.target)).toEqual([
      'strip.level',
      'strip.pan',
      ...RETURN_NAMES.map((name) => `strip.send.${name}`),
    ]);
  });

  it('draw the level in dB from the floor in the tables', () => {
    const level = STRIP_AUTOMATION_ROWS[0]!;
    expect(level.scale).toBe('db');
    expect(level.min).toBe(0);
    expect(20 * Math.log10(level.floor!)).toBeCloseTo(AUTOMATION_LEVEL_FLOOR_DB, 12);
  });
});
