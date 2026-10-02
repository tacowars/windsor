/**
 * The voice target curve (windsor#419): 0 is the patch's value exactly, an
 * offset moves the base in its row's curve, a ratio from the row's floor,
 * and the result clamps to the row's bounds; a step's value is its span's
 * offset.
 */
import { describe, expect, it } from 'vitest';

import type { VoiceTargetRow } from './voiceTargetTables';
import { VOICE_TARGET_TABLE } from './voiceTargetTables';
import { stepModValue, voiceTargetValue } from './voiceTargetValue';

const row = (path: string): VoiceTargetRow => VOICE_TARGET_TABLE.find((r) => r.path === path)!;
const CUTOFF = row('filter.cutoff');
const DECAY = row('ops.0.env.decayTime');
const LEVEL = row('ops.1.level');

describe('voiceTargetValue and stepModValue', () => {
  it('hand back the base untouched at 0, even outside the row’s bounds', () => {
    expect(voiceTargetValue(CUTOFF, 20000, 0)).toBe(20000);
    expect(voiceTargetValue(DECAY, 0, 0)).toBe(0);
    expect(stepModValue(CUTOFF, 8000, 0)).toBe(8000);
    expect(stepModValue(LEVEL, 0.3, -0)).toBe(0.3);
  });

  it('add an add row’s span', () => {
    expect(stepModValue(LEVEL, 0.3, 0.5)).toBeCloseTo(0.3 + 0.5 * LEVEL.span, 12);
    expect(stepModValue(LEVEL, 0.8, -1)).toBeCloseTo(0.8 - LEVEL.span, 12);
  });

  it('move a ratio row in octaves: +0.5 is half the span up', () => {
    expect(Math.log2(stepModValue(CUTOFF, 1000, 0.5) / 1000)).toBeCloseTo(CUTOFF.span / 2, 12);
    expect(Math.log2(stepModValue(DECAY, 0.01, 0.5) / 0.01)).toBeCloseTo(DECAY.span / 2, 12);
  });

  it('take a ratio from the row’s floor under it: a step is heard over a decay of 0', () => {
    expect(voiceTargetValue(DECAY, 0, 1)).toBeCloseTo(0.002, 15);
    expect(stepModValue(DECAY, 0, 0.5)).toBeCloseTo(0.001 * 2 ** (DECAY.span / 2), 12);
  });

  it('clamp to the row’s bounds', () => {
    for (const r of VOICE_TARGET_TABLE) {
      expect(stepModValue(r, r.max, 1), r.path).toBe(r.max);
      expect(stepModValue(r, r.min, -1), r.path).toBe(r.min);
    }
  });
});
