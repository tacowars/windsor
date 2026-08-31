import { mulberry32 } from '@aotearoa/shared';
import { describe, expect, it } from 'vitest';

import { SCALES, SCALE_NAMES, ScaleSampler, uniformWeights } from './scaleSampler';

describe('SCALES', () => {
  it('start on the root and stay inside the octave, ascending', () => {
    for (const name of SCALE_NAMES) {
      const s = SCALES[name];
      expect(s[0]).toBe(0);
      for (let i = 1; i < s.length; i++) expect(s[i]!).toBeGreaterThan(s[i - 1]!);
      expect(s.at(-1)!).toBeLessThan(12);
    }
  });
});

describe('ScaleSampler', () => {
  it('maps a degree and an octave to a MIDI note', () => {
    const sampler = new ScaleSampler({
      root: 48,
      scale: 'dorian',
      weights: uniformWeights('dorian'),
    });
    expect(sampler.noteFor(0, 0)).toBe(48);
    expect(sampler.noteFor(2, 0)).toBe(51);
    expect(sampler.noteFor(4, 1)).toBe(67);
    expect(sampler.noteFor(6, -1)).toBe(46);
    expect(() => sampler.noteFor(7, 0)).toThrow(RangeError);
  });

  it('draws degrees in proportion to their weights and never a zero-weight one', () => {
    const sampler = new ScaleSampler({ root: 60, scale: 'major', weights: [4, 0, 2, 0, 1, 0, 1] });
    const rng = mulberry32(7);
    const counts = new Array<number>(7).fill(0);
    const draws = 8000;
    for (let i = 0; i < draws; i++) counts[sampler.sampleDegree(rng)]!++;
    expect(counts[1]).toBe(0);
    expect(counts[3]).toBe(0);
    expect(counts[5]).toBe(0);
    expect(counts[0]! / draws).toBeCloseTo(0.5, 1);
    expect(counts[2]! / draws).toBeCloseTo(0.25, 1);
    expect(counts[4]! / draws).toBeCloseTo(0.125, 1);
    expect(counts[6]! / draws).toBeCloseTo(0.125, 1);
  });

  it('is deterministic for a seed', () => {
    const cfg = { root: 60, scale: 'pentatonicMinor', weights: [3, 1, 2, 1, 1] } as const;
    const a = new ScaleSampler(cfg);
    const b = new ScaleSampler(cfg);
    const ra = mulberry32(99);
    const rb = mulberry32(99);
    const reg = { octave: 1, span: 2 };
    for (let i = 0; i < 64; i++) expect(a.sampleNote(ra, reg)).toEqual(b.sampleNote(rb, reg));
  });

  it('spreads notes over the register span and pins them when span is 1', () => {
    const sampler = new ScaleSampler({
      root: 48,
      scale: 'major',
      weights: uniformWeights('major'),
    });
    const rng = mulberry32(3);
    const pinned = new Set<number>();
    for (let i = 0; i < 200; i++)
      pinned.add(Math.floor((sampler.sampleNote(rng, { octave: 2, span: 1 }).note - 48) / 12));
    expect([...pinned]).toEqual([2]);
    const spread = new Set<number>();
    for (let i = 0; i < 200; i++)
      spread.add(Math.floor((sampler.sampleNote(rng, { octave: -1, span: 3 }).note - 48) / 12));
    expect([...spread].sort((a, b) => a - b)).toEqual([-1, 0, 1]);
  });

  it('accepts explicit offsets in place of a scale name', () => {
    const sampler = new ScaleSampler({ root: 60, scale: [0, 7], weights: [1, 1] });
    expect(sampler.degreeCount).toBe(2);
    expect(sampler.noteFor(1, 0)).toBe(67);
  });

  it('rejects a config the arrangement normaliser should never hand it', () => {
    expect(() => new ScaleSampler({ root: 60, scale: 'major', weights: [1, 1] })).toThrow(
      RangeError,
    );
    expect(
      () => new ScaleSampler({ root: 60, scale: 'major', weights: [0, 0, 0, 0, 0, 0, 0] }),
    ).toThrow(RangeError);
    expect(
      () => new ScaleSampler({ root: 60, scale: 'major', weights: [1, -1, 1, 1, 1, 1, 1] }),
    ).toThrow(RangeError);
    expect(() => new ScaleSampler({ root: 60, scale: [], weights: [] })).toThrow(RangeError);
  });
});
