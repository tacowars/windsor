import { describe, expect, it } from 'vitest';

import { WAVE as MAIN_WAVE } from '../../patch/patch';
import { MIP_COUNT, TABLE_SIZE } from './fmConstants';
import { WAVE } from './waveIds';

// The module warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { getMips, KIND_NOISE, KIND_PULSE, KIND_SAW_D, KIND_TABLE, mipIndex, SIN_TAB, waveKind } =
  await import('./waveTables');

describe('the wave tables', () => {
  it('are the ids the main thread re-exports (#656)', () => {
    expect(MAIN_WAVE).toBe(WAVE);
  });

  it('hold an exact sine', () => {
    expect(SIN_TAB).toHaveLength(TABLE_SIZE);
    expect(SIN_TAB[TABLE_SIZE / 4]).toBeCloseTo(1, 6);
    expect(SIN_TAB[TABLE_SIZE / 2]).toBeCloseTo(0, 6);
  });

  it('build one guarded table per octave, once, and share it across callers', () => {
    const mips = getMips(WAVE.SAW, 48000, 1, null);
    expect(mips).toHaveLength(MIP_COUNT);
    for (const t of mips) {
      expect(t).toHaveLength(TABLE_SIZE + 1);
      expect(t[TABLE_SIZE]).toBe(t[0]);
    }
    expect(getMips(WAVE.SAW, 48000, 1, null)).toBe(mips);
    expect(getMips(WAVE.SAW, 48000, 0.5, null)).not.toBe(mips);
  });

  it('quantise the 4-bit sine to nine levels each side of zero', () => {
    const levels = new Set(getMips(WAVE.SINE_4BIT, 48000, 1, null)[0]);
    expect(levels.size).toBeLessThanOrEqual(17);
    for (const v of levels) expect(v * 8).toBe(Math.round(v * 8));
  });

  it('pick the octave table by frequency', () => {
    expect(mipIndex(10)).toBe(0);
    expect(mipIndex(16.352 * 8 + 1)).toBe(3);
    expect(mipIndex(1e6)).toBe(MIP_COUNT - 1);
  });

  it('map raw and noise waves to their render kinds', () => {
    expect(waveKind(WAVE.NOISE)).toBe(KIND_NOISE);
    expect(waveKind(WAVE.SAW_D)).toBe(KIND_SAW_D);
    expect(waveKind(WAVE.SINE)).toBe(KIND_TABLE);
    expect(waveKind(WAVE.USER)).toBe(KIND_TABLE);
    expect(waveKind(WAVE.PULSE)).toBe(KIND_PULSE);
  });

  it('give PULSE the saw’s own tables, one copy in the cache (#55)', () => {
    expect(getMips(WAVE.PULSE, 48000, 1, null)).toBe(getMips(WAVE.SAW, 48000, 1, null));
    expect(getMips(WAVE.PULSE, 48000, 0.5, null)).toBe(getMips(WAVE.SAW, 48000, 0.5, null));
  });
});
