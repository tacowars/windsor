/**
 * The one voice target table (windsor#419): thirty-eight rows in code order,
 * the last eight the macros' (windsor#559), the codes the voice addresses
 * them by, bounds that mirror the patch's clamps and the knobs, the two
 * curves, and the spans a step pushes by.
 */
import { describe, expect, it } from 'vitest';

import {
  FEEDBACK_RANGE,
  MACRO_VALUE_RANGE,
  OPERATOR_COUNT,
  VOWEL_RANGE,
  WIDTH_RANGE,
} from './patchDefaults';
import {
  MACROS_MAX,
  VOICE_TARGET_COUNT,
  VOICE_TARGET_FLOOR,
  VOICE_TARGET_MAX,
  VOICE_TARGET_MIN,
  VOICE_TARGET_PATHS,
  VOICE_TARGET_RATIO,
  VOICE_TARGET_SLIDE_KEEPS,
  VOICE_TARGET_SPAN,
  VOICE_TARGET_TABLE,
  VT_CUTOFF,
  VT_ENV_AMOUNT,
  VT_FILTER_DECAY,
  VT_LFO2_AMOUNT,
  VT_LFO2_RATE,
  VT_LFO_AMOUNT,
  VT_LFO_RATE,
  VT_MACRO_BASE,
  VT_OP_BASE,
  VT_OP_DECAY,
  VT_OP_DECAY_CURVE,
  VT_OP_FEEDBACK,
  VT_OP_LEVEL,
  VT_OP_STRIDE,
  VT_OP_WIDTH,
  VT_PITCH_ENV_AMOUNT,
  VT_RESONANCE,
  VT_VOWEL,
  isMacroCode,
  macroIndexOf,
  macroTargetProblem,
  voiceTargetCode,
  voiceTargetRow,
} from './voiceTargetTables';

const row = (path: string) => VOICE_TARGET_TABLE.find((r) => r.path === path);
const DECAY_TIME = /\.decayTime$/;

describe('the voice target table (windsor#419)', () => {
  it('has five filter rows, five per operator, five more and eight macros, each path once', () => {
    expect(VOICE_TARGET_COUNT).toBe(38);
    expect(MACROS_MAX).toBe(8);
    expect(VOICE_TARGET_PATHS).toHaveLength(VOICE_TARGET_COUNT);
    expect(new Set(VOICE_TARGET_PATHS).size).toBe(VOICE_TARGET_COUNT);
  });

  it('puts every row at the code the voice reads it by', () => {
    expect(VOICE_TARGET_PATHS[VT_CUTOFF]).toBe('filter.cutoff');
    expect(VOICE_TARGET_PATHS[VT_ENV_AMOUNT]).toBe('filter.envAmount');
    expect(VOICE_TARGET_PATHS[VT_RESONANCE]).toBe('filter.resonance');
    expect(VOICE_TARGET_PATHS[VT_FILTER_DECAY]).toBe('filter.env.decayTime');
    expect(VOICE_TARGET_PATHS[VT_VOWEL]).toBe('filter.vowel');
    for (let i = 0; i < OPERATOR_COUNT; i++) {
      const b = VT_OP_BASE + i * VT_OP_STRIDE;
      expect(VOICE_TARGET_PATHS[b + VT_OP_LEVEL]).toBe(`ops.${i}.level`);
      expect(VOICE_TARGET_PATHS[b + VT_OP_DECAY]).toBe(`ops.${i}.env.decayTime`);
      expect(VOICE_TARGET_PATHS[b + VT_OP_DECAY_CURVE]).toBe(`ops.${i}.env.decayCurve`);
      expect(VOICE_TARGET_PATHS[b + VT_OP_FEEDBACK]).toBe(`ops.${i}.feedback`);
      expect(VOICE_TARGET_PATHS[b + VT_OP_WIDTH]).toBe(`ops.${i}.width`);
    }
    expect(VOICE_TARGET_PATHS[VT_LFO_AMOUNT]).toBe('lfo.amount');
    expect(VOICE_TARGET_PATHS[VT_LFO_RATE]).toBe('lfo.rate');
    expect(VOICE_TARGET_PATHS[VT_LFO2_AMOUNT]).toBe('lfo2.amount');
    expect(VOICE_TARGET_PATHS[VT_LFO2_RATE]).toBe('lfo2.rate');
    expect(VOICE_TARGET_PATHS[VT_PITCH_ENV_AMOUNT]).toBe('pitchEnvAmount');
    // The first 30 codes did not move when the macros came (windsor#559).
    expect([VT_PITCH_ENV_AMOUNT, VT_MACRO_BASE]).toEqual([29, 30]);
    for (let i = 0; i < MACROS_MAX; i++) {
      expect(VOICE_TARGET_PATHS[VT_MACRO_BASE + i]).toBe(`macros.${i}.value`);
    }
    VOICE_TARGET_PATHS.forEach((path, k) => expect(voiceTargetCode(path)).toBe(k));
  });

  it('lays the typed arrays out from the rows', () => {
    VOICE_TARGET_TABLE.forEach((r, k) => {
      expect(VOICE_TARGET_RATIO[k], r.path).toBe(r.curve === 'ratio' ? 1 : 0);
      expect([VOICE_TARGET_MIN[k], VOICE_TARGET_MAX[k]], r.path).toEqual([r.min, r.max]);
      expect(VOICE_TARGET_FLOOR[k], r.path).toBe(r.floor);
      expect(VOICE_TARGET_SPAN[k], r.path).toBe(r.span);
      expect(VOICE_TARGET_SLIDE_KEEPS[k], r.path).toBe(r.slideKeeps ? 1 : 0);
    });
  });

  it('gives every row a positive span and a range, and a ratio row a positive bottom', () => {
    for (const r of VOICE_TARGET_TABLE) {
      expect(r.span, r.path).toBeGreaterThan(0);
      expect(r.max, r.path).toBeGreaterThan(r.min);
      if (r.curve === 'ratio') expect(r.min, r.path).toBeGreaterThan(0);
      else expect(r.floor, r.path).toBe(0);
    }
  });

  it('scales the cutoff, the LFO rates and the decay times by a ratio and offsets the rest', () => {
    const ratio = VOICE_TARGET_TABLE.filter((r) => r.curve === 'ratio').map((r) => r.path);
    expect(ratio).toEqual(
      VOICE_TARGET_PATHS.filter(
        (p) => p === 'filter.cutoff' || p === 'lfo.rate' || p === 'lfo2.rate' || DECAY_TIME.test(p),
      ),
    );
    expect(ratio).toHaveLength(8);
  });

  it('takes a decay time’s ratio from its 1 ms floor, an LFO rate’s from 0.02 Hz, and no other row’s from one', () => {
    for (const r of VOICE_TARGET_TABLE) {
      const decay = DECAY_TIME.test(r.path);
      const lfoRate = r.path === 'lfo.rate' || r.path === 'lfo2.rate';
      expect(r.floor, r.path).toBe(decay ? 0.001 : lfoRate ? 0.02 : 0);
      if (decay) expect([r.min, r.max], r.path).toEqual([0.001, 20]);
      if (lfoRate) expect(r.floor, r.path).toBe(r.min);
    }
  });

  it('spans a ratio row in octaves: the cutoff 4.5, a log knob half its travel', () => {
    expect(row('filter.cutoff')?.span).toBe(4.5);
    expect(row('ops.2.env.decayTime')?.span).toBeCloseTo(0.5 * Math.log2(20 / 0.001), 12);
    expect(row('lfo.rate')?.span).toBeCloseTo(0.5 * Math.log2(40 / 0.02), 12);
  });

  it('bounds feedback, width and the vowel by the clamps the worklet applies to the patch', () => {
    for (let i = 0; i < OPERATOR_COUNT; i++) {
      expect(row(`ops.${i}.feedback`)).toMatchObject({ curve: 'add', ...FEEDBACK_RANGE });
      expect(row(`ops.${i}.width`)).toMatchObject({ curve: 'add', span: 0.5, ...WIDTH_RANGE });
    }
    expect(row('filter.vowel')).toMatchObject({ curve: 'add', span: 2, ...VOWEL_RANGE });
  });

  it('gives each macro an add row over 0..1 that one step sweeps (windsor#559)', () => {
    expect(MACRO_VALUE_RANGE).toEqual({ min: 0, max: 1 });
    for (let i = 0; i < MACROS_MAX; i++) {
      expect(VOICE_TARGET_TABLE[VT_MACRO_BASE + i]).toEqual({
        path: `macros.${i}.value`,
        curve: 'add',
        min: 0,
        max: 1,
        floor: 0,
        span: 1,
        slideKeeps: false,
      });
    }
  });

  it('tells a macro row by its code and its path', () => {
    const macros = VOICE_TARGET_PATHS.filter((_, k) => isMacroCode(k));
    expect(macros).toEqual(VOICE_TARGET_PATHS.slice(VT_MACRO_BASE));
    expect(isMacroCode(-1)).toBe(false);
    expect(isMacroCode(VOICE_TARGET_COUNT)).toBe(false);
    expect(macroIndexOf('macros.3.value')).toBe(3);
    expect(macroIndexOf('filter.cutoff')).toBe(-1);
    expect(macroIndexOf('macros.8.value')).toBe(-1);
  });

  it('lets a macro map any other row once, and no macro row (record decision 5)', () => {
    const taken = new Set(['ops.0.level']);
    expect(macroTargetProblem('filter.cutoff', taken)).toBeUndefined();
    expect(macroTargetProblem('ops.0.level', taken)).toBe('ops.0.level is already mapped');
    expect(macroTargetProblem('macros.1.value', taken)).toBe('macros.1.value is a macro');
    expect(macroTargetProblem('volume', taken)).toBe('"volume" is not a voice target');
    expect(macroTargetProblem(undefined, taken)).toBe('undefined is not a voice target');
  });

  it('keeps the old offsets on a slide only for the decay curve and feedback', () => {
    const kept = VOICE_TARGET_TABLE.filter((r) => r.slideKeeps).map((r) => r.path);
    const expected = Array.from({ length: OPERATOR_COUNT }, (_, i) => [
      `ops.${i}.env.decayCurve`,
      `ops.${i}.feedback`,
    ]).flat();
    expect(kept).toEqual(expected);
  });

  it('maps no code to a field no row carries, or to junk', () => {
    for (const path of ['ops.0.env.attackTime', 'volume', '', null, 3, 'voice.filter.cutoff']) {
      expect(voiceTargetCode(path)).toBe(-1);
      expect(voiceTargetRow(path)).toBeUndefined();
    }
  });

  it('looks a row up by its path, as the table holds it', () => {
    for (const r of VOICE_TARGET_TABLE) expect(voiceTargetRow(r.path)).toBe(r);
  });
});
