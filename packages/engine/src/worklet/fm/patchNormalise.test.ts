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
    expect(normalisePatch(undefined).ops[3].env.sustainLevel).toBe(0.7);
  });

  it('clamps the algorithm, the tone and the feedback', () => {
    const p = normalisePatch({ algorithm: 99, tone: 0, ops: [{ feedback: 2 }, { feedback: -3 }] });
    expect(p.algorithm).toBe(10);
    expect(p.tone).toBe(0.02);
    expect(p.ops[0].feedback).toBe(1);
    expect(p.ops[1].feedback).toBe(-1);
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

  it('clamps the operator width into WIDTH_RANGE and replaces a non-number with 1 (windsor#54)', () => {
    const p = normalisePatch({ ops: [{ width: 0 }, { width: 3 }, { width: 0.5 }, {}] });
    expect(p.ops.map((op) => op.width)).toEqual([0.05, 1, 0.5, 1]);
    const junk = { ops: [{ width: 'wide' }] } as unknown as Parameters<typeof normalisePatch>[0];
    expect(normalisePatch(junk).ops[0].width).toBe(1);
  });

  it("fills a Noise operator's colour with 0 (off), keeps a cutoff and clamps it into NOISE_COLOUR_RANGE (windsor#362)", () => {
    const empty = normalisePatch({});
    expect(empty.ops.map((op) => [op.noiseLp, op.noiseHp])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    const p = normalisePatch({
      ops: [
        { noiseLp: 10089.5, noiseHp: 2370.25 },
        { noiseLp: 50000, noiseHp: -3 },
      ],
    });
    expect([p.ops[0].noiseLp, p.ops[0].noiseHp]).toEqual([10089.5, 2370.25]);
    expect([p.ops[1].noiseLp, p.ops[1].noiseHp]).toEqual([20000, 0]);
    const junk = { ops: [{ noiseLp: 'bright' }] } as unknown as Parameters<
      typeof normalisePatch
    >[0];
    expect(normalisePatch(junk).ops[0].noiseLp).toBe(0);
  });

  it('fills the LFO fields and an inert LFO 2 that ignores the wheel (windsor#54)', () => {
    const p = normalisePatch({});
    const zeros = [0, 0, 0, 0];
    expect(p.lfo).toMatchObject({ oneShot: false, unipolar: false, toWidth: zeros });
    expect(p.lfo2).toMatchObject({ amount: 0, modWheelDepth: 0, toOp: zeros, toWidth: zeros });
    expect(p.filter.lfo2Amount).toBe(0);
    const set = normalisePatch({ lfo2: { unipolar: true, toWidth: [0.3] } });
    expect(set.lfo2.unipolar).toBe(true);
    expect(set.lfo2.toWidth).toEqual([0.3, 0, 0, 0]);
  });

  it('keeps the seven filter modes, Acid the last, and plays any other as Off (windsor#331, windsor#573)', () => {
    const mode = (m: unknown): number =>
      normalisePatch({ filter: { mode: m } } as unknown as Parameters<typeof normalisePatch>[0])
        .filter.mode;
    expect([0, 1, 2, 3, 4, 5, 6].map(mode)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([9, 7, -1, 'lp', undefined].map(mode)).toEqual([0, 0, 0, 0, 0]);
  });

  it('fills the Formant vowel with 0 (a), keeps a fraction and clamps it into 0..4 (windsor#331)', () => {
    const vowel = (v: unknown): number =>
      normalisePatch({ filter: { vowel: v } } as unknown as Parameters<typeof normalisePatch>[0])
        .filter.vowel;
    expect(normalisePatch({}).filter.vowel).toBe(0);
    expect([0.5, 3.25, 4, 4.5, -1, 'o', NaN].map(vowel)).toEqual([0.5, 3.25, 4, 4, 0, 0, 0]);
  });

  it('keeps a finite number and replaces anything else', () => {
    expect(num(3, 1)).toBe(3);
    expect(num('3', 1)).toBe(1);
    expect(num(NaN, 1)).toBe(1);
    expect(num(Infinity, 2)).toBe(2);
    expect(num(undefined, 0)).toBe(0);
  });
});
