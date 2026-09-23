import { describe, expect, it } from 'vitest';

// `waveTables` warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { normalisePatch, num } = await import('./patchNormalise');

describe('patch normalisation', () => {
  it('fills every field of an empty patch with the engine defaults', () => {
    const p = normalisePatch({});
    expect(p.name).toBe('untitled');
    expect(p.ops).toHaveLength(4);
    expect(p.ops[0].level).toBe(1);
    expect(p.ops[1].level).toBe(0);
    expect(p.ops[0].phaseFree).toBe(true);
    expect(p.volume).toBe(0.8);
    expect(p.filter.cutoff).toBe(8000);
    expect(p.lfo.rate).toBe(5);
    expect(p.feedbackScratch).toBeInstanceOf(Float32Array);
    expect(p.feedbackScratch).toHaveLength(4);
    expect(normalisePatch(undefined).ops[3].env.sustainLevel).toBe(0.7);
  });

  it('clamps the algorithm, the tone and the feedback, and mirrors feedback into the scratch', () => {
    const p = normalisePatch({ algorithm: 99, tone: 0, ops: [{ feedback: 2 }, { feedback: -3 }] });
    expect(p.algorithm).toBe(10);
    expect(p.tone).toBe(0.02);
    expect(p.ops[0].feedback).toBe(1);
    expect(p.ops[1].feedback).toBe(-1);
    expect(Array.from(p.feedbackScratch)).toEqual([1, -1, 0, 0]);
  });

  it('keeps a finite number and replaces anything else', () => {
    expect(num(3, 1)).toBe(3);
    expect(num('3', 1)).toBe(1);
    expect(num(NaN, 1)).toBe(1);
    expect(num(Infinity, 2)).toBe(2);
    expect(num(undefined, 0)).toBe(0);
  });
});
