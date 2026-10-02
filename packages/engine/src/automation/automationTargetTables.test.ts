import { describe, expect, it } from 'vitest';
import { RETURN_NAMES } from '../mixer/mix';
import { VOWEL_RANGE } from '../worklet/fm/patchDefaults';
import { VOICE_TARGET_TABLE } from '../worklet/fm/voiceTargetTables';
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
  'voice.filter.vowel',
  ...[0, 1, 2, 3].flatMap((i) => OPERATOR_FIELDS.map((f) => `voice.ops.${i}.${f}`)),
  'voice.lfo.amount',
  'voice.lfo.rate',
  'voice.lfo2.amount',
  'voice.lfo2.rate',
  'voice.pitchEnvAmount',
];

describe('the voice rows', () => {
  it('are exactly the 29 targets of decision 2 and the Formant vowel (windsor#406)', () => {
    expect(VOICE_AUTOMATION_ROWS).toHaveLength(30);
    expect(VOICE_AUTOMATION_ROWS.map((r) => r.target)).toEqual(VOICE_IDS);
    expect(new Set(VOICE_AUTOMATION_ROWS.map((r) => r.label)).size).toBe(30);
  });

  it('name each target once, short enough for a step lane header (windsor#424)', () => {
    const operator = (name: string): string[] =>
      ['Level', 'Decay', 'Decay Crv', 'Feedback', 'Width'].map((f) => `Op ${name} ${f}`);
    expect(VOICE_AUTOMATION_ROWS.map((r) => r.label)).toEqual([
      'Cutoff',
      'Filter Env Amt',
      'Resonance',
      'Filter Decay',
      'Vowel',
      ...['A', 'B', 'C', 'D'].flatMap(operator),
      'LFO 1 Amount',
      'LFO 1 Rate',
      'LFO 2 Amount',
      'LFO 2 Rate',
      'Pitch Env Amt',
    ]);
  });

  it('carry the vowel as a linear 0–4 lane, the patch’s vowel range', () => {
    const vowel = VOICE_AUTOMATION_ROWS.find((r) => r.target === 'voice.filter.vowel')!;
    expect(vowel).toEqual({
      target: 'voice.filter.vowel',
      label: 'Vowel',
      min: VOWEL_RANGE.min,
      max: VOWEL_RANGE.max,
      scale: 'linear',
      unit: '',
    });
    expect([vowel.min, vowel.max]).toEqual([0, 4]);
  });

  it('are the voice target table, in its order (windsor#419)', () => {
    expect(VOICE_AUTOMATION_ROWS.map((r) => r.target)).toEqual(
      VOICE_TARGET_TABLE.map((row) => `voice.${row.path}`),
    );
  });

  it('take the target table bounds, a decay time from 0 with its floor as the display floor', () => {
    for (const step of VOICE_TARGET_TABLE) {
      const row = VOICE_AUTOMATION_ROWS.find((r) => r.target === `voice.${step.path}`)!;
      expect(row.max, step.path).toBe(step.max);
      if (step.path.endsWith('decayTime')) {
        expect(row.min).toBe(0);
        expect(row.floor).toBe(step.floor);
        expect(row.floor).toBe(0.001);
        expect(row.scale).toBe('log');
      } else {
        expect(row.min, step.path).toBe(step.min);
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
