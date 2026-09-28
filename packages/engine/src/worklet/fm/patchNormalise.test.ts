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

  it("ignores a stray retired key, as a song's format-1 snapshot still carries userKey", () => {
    // The normaliser reads known fields only, so a key format 2 retired
    // (record `2026-09-28-retire-the-headroom-record`) is never copied.
    const stray = { ops: [{ ratio: 2, userKey: 'bell' }] } as unknown as Parameters<
      typeof normalisePatch
    >[0];
    const p = normalisePatch(stray);
    expect(p.ops[0].ratio).toBe(2);
    expect(Object.keys(p.ops[0])).not.toContain('userKey');
    expect(p.ops[0]).toEqual(normalisePatch({ ops: [{ ratio: 2 }] }).ops[0]);
  });

  it('keeps a finite number and replaces anything else', () => {
    expect(num(3, 1)).toBe(3);
    expect(num('3', 1)).toBe(1);
    expect(num(NaN, 1)).toBe(1);
    expect(num(Infinity, 2)).toBe(2);
    expect(num(undefined, 0)).toBe(0);
  });
});
