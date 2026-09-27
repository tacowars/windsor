import { describe, expect, it } from 'vitest';

import { SCALES, SCALE_NAMES, ScaleSampler, foldDegree } from './scaleSampler';

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
  it('maps a degree and an absolute MIDI octave to a MIDI note (#705: 12 × (octave + 1) + root + offset)', () => {
    const sampler = new ScaleSampler({ root: 0, scale: 'dorian' });
    expect(sampler.noteFor(0, 3)).toBe(48);
    expect(sampler.noteFor(2, 3)).toBe(51);
    expect(sampler.noteFor(4, 4)).toBe(67);
    expect(sampler.noteFor(6, 2)).toBe(46);
    expect(() => sampler.noteFor(7, 3)).toThrow(RangeError);
  });

  it('places the root pitch class in MIDI octave numbering (#705)', () => {
    expect(new ScaleSampler({ root: 0, scale: 'major' }).rootNote(3)).toBe(48);
    expect(new ScaleSampler({ root: 0, scale: 'major' }).rootNote(-1)).toBe(0);
    const d = new ScaleSampler({ root: 2, scale: 'dorian' });
    expect(d.rootNote(4)).toBe(62);
    expect(d.noteFor(2, 4)).toBe(d.rootNote(4) + 3);
  });

  it('accepts explicit offsets in place of a scale name', () => {
    const sampler = new ScaleSampler({ root: 0, scale: [0, 7] });
    expect(sampler.degreeCount).toBe(2);
    expect(sampler.noteFor(1, 4)).toBe(67);
  });

  it('rejects a scale with no degrees', () => {
    expect(() => new ScaleSampler({ root: 0, scale: [] })).toThrow(RangeError);
  });

  it('carries no weights and draws nothing: grid and chord read only the mapping (#704)', () => {
    const sampler = new ScaleSampler({ root: 0, scale: 'major' });
    expect(Object.keys(sampler).sort()).toEqual(['offsets', 'root']);
  });
});

describe('foldDegree (#602)', () => {
  it('wraps a degree past the scale end with octave carry', () => {
    expect(foldDegree(6, 5)).toEqual({ degree: 1, carry: 1 });
    expect(foldDegree(7, 7)).toEqual({ degree: 0, carry: 1 });
    expect(foldDegree(4, 7)).toEqual({ degree: 4, carry: 0 });
    expect(foldDegree(11, 5)).toEqual({ degree: 1, carry: 2 });
  });

  it('a one-degree scale maps every degree to the root in some octave', () => {
    const one = new ScaleSampler({ root: 0, scale: [0] });
    expect(one.noteForFolded(0, 4)).toBe(60);
    expect(one.noteForFolded(3, 4)).toBe(60 + 36);
    expect(one.noteForFolded(2, 3)).toBe(60 + 12);
  });

  it('degree 6 in pentatonic minor is degree 1 an octave up; the same degree round-trips through seven', () => {
    const seven = new ScaleSampler({ root: 0, scale: 'naturalMinor' });
    const five = new ScaleSampler({ root: 0, scale: 'pentatonicMinor' });
    expect(seven.noteForFolded(6, 3)).toBe(48 + 10);
    expect(five.noteForFolded(6, 3)).toBe(48 + 3 + 12);
    // The written degree is untouched by the fold: back in seven it is the seventh again.
    expect(seven.noteForFolded(6, 3)).toBe(seven.noteFor(6, 3));
  });
});
