import { describe, expect, it } from 'vitest';
import { RETURN_NAMES } from '../mixer/mix';
import { VOWEL_RANGE } from '../worklet/fm/patchDefaults';
import {
  VOICE_TARGET_TABLE,
  VT_LFO2_RATE,
  VT_MACRO_BASE,
  VT_OP_BASE,
  VT_OP_STRIDE,
  VT_OP_WIDTH,
  VT_PITCH_ENV_AMOUNT,
  VT_VOWEL,
} from '../worklet/fm/voiceTargetTables';
import {
  AUTOMATION_LEVEL_FLOOR_DB,
  FM_LANES_MAX,
  STRIP_AUTOMATION_ROWS,
  voiceSectionOf,
  type VoiceSection,
} from './automationTargetTables';
import { VOICE_AUTOMATION_ROWS, voiceTargetId } from './automationTargets';

const OPERATOR_FIELDS = ['level', 'env.decayTime', 'env.decayCurve', 'feedback', 'width'];
const MACROS = [0, 1, 2, 3, 4, 5, 6, 7];

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
  ...MACROS.map((i) => `voice.macros.${i}.value`),
];

describe('the voice rows', () => {
  it('are the 29 targets of decision 2, the Formant vowel (windsor#406) and eight macros (windsor#559)', () => {
    expect(VOICE_AUTOMATION_ROWS).toHaveLength(38);
    expect(VOICE_AUTOMATION_ROWS.map((r) => r.target)).toEqual(VOICE_IDS);
    expect(new Set(VOICE_AUTOMATION_ROWS.map((r) => r.label)).size).toBe(38);
  });

  it('name each target once, short enough for a step lane header (windsor#424)', () => {
    const operator = (name: string): string[] =>
      ['Level', 'Decay', 'Dcy Crv', 'Fdbk', 'Width'].map((f) => `Op ${name} ${f}`);
    expect(VOICE_AUTOMATION_ROWS.map((r) => r.label)).toEqual([
      'Cutoff',
      'Filt Env Amt',
      'Resonance',
      'Filter Decay',
      'Vowel',
      ...['A', 'B', 'C', 'D'].flatMap(operator),
      'LFO 1 Amt',
      'LFO 1 Rate',
      'LFO 2 Amt',
      'LFO 2 Rate',
      'Pitch Env',
      ...MACROS.map((i) => `Macro ${i + 1}`),
    ]);
  });

  it('carry a macro as a linear 0–1 lane in its own section', () => {
    expect(VOICE_AUTOMATION_ROWS.find((r) => r.target === 'voice.macros.2.value')).toEqual({
      target: 'voice.macros.2.value',
      label: 'Macro 3',
      min: 0,
      max: 1,
      scale: 'linear',
      unit: '',
      path: 'macros.2.value',
      section: { kind: 'macro', index: 2 },
    });
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
      path: 'filter.vowel',
      section: { kind: 'filter' },
    });
    expect([vowel.min, vowel.max]).toEqual([0, 4]);
  });

  it('carry their patch path (windsor#436)', () => {
    expect(VOICE_AUTOMATION_ROWS.map((r) => r.path)).toEqual(
      VOICE_TARGET_TABLE.map((row) => row.path),
    );
  });

  it('carry their section: the filter, operator i, the LFOs, the pitch envelope or macro i', () => {
    const section = (r: { section: VoiceSection }): string =>
      r.section.kind === 'operator'
        ? `op ${r.section.op}`
        : r.section.kind === 'macro'
          ? `macro ${r.section.index}`
          : r.section.kind;
    const operator = (i: number): string[] => OPERATOR_FIELDS.map(() => `op ${i}`);
    expect(VOICE_AUTOMATION_ROWS.map(section)).toEqual([
      ...Array<string>(5).fill('filter'),
      ...[0, 1, 2, 3].flatMap(operator),
      ...Array<string>(4).fill('lfo'),
      'pitch',
      ...MACROS.map((i) => `macro ${i}`),
    ]);
  });

  it('read a section from the code alone', () => {
    expect(voiceSectionOf(VT_VOWEL)).toEqual({ kind: 'filter' });
    expect(voiceSectionOf(VT_OP_BASE + 2 * VT_OP_STRIDE + VT_OP_WIDTH)).toEqual({
      kind: 'operator',
      op: 2,
    });
    expect(voiceSectionOf(VT_LFO2_RATE)).toEqual({ kind: 'lfo' });
    expect(voiceSectionOf(VT_PITCH_ENV_AMOUNT)).toEqual({ kind: 'pitch' });
    expect(voiceSectionOf(VT_MACRO_BASE + 7)).toEqual({ kind: 'macro', index: 7 });
  });

  it('are the voice target table, in its order (windsor#419)', () => {
    expect(VOICE_AUTOMATION_ROWS.map((r) => r.target)).toEqual(
      VOICE_TARGET_TABLE.map((row) => voiceTargetId(row.path)),
    );
  });

  it('take the target table bounds, a decay time from 0 with its floor as the display floor', () => {
    for (const step of VOICE_TARGET_TABLE) {
      const row = VOICE_AUTOMATION_ROWS.find((r) => r.target === voiceTargetId(step.path))!;
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
