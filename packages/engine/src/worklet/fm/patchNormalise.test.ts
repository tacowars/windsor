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

  it("fills an operator's own filters with 0 (off, untracked), keeps a value and clamps it into OP_FILTER_RANGE and OP_FILTER_TRACK_RANGE (windsor#590)", () => {
    const empty = normalisePatch({});
    expect(empty.ops.map((op) => [op.opLp, op.opHp, op.opTrack])).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    const p = normalisePatch({
      ops: [
        { opLp: 10089.5, opHp: 2370.25, opTrack: 0.75 },
        { opLp: 50000, opHp: -3, opTrack: 5 },
        { opTrack: -4 },
      ],
    });
    expect([p.ops[0].opLp, p.ops[0].opHp, p.ops[0].opTrack]).toEqual([10089.5, 2370.25, 0.75]);
    expect([p.ops[1].opLp, p.ops[1].opHp, p.ops[1].opTrack]).toEqual([20000, 0, 2]);
    expect(p.ops[2].opTrack).toBe(-1);
    const junk = { ops: [{ opLp: 'bright', opTrack: 'up' }] } as unknown as Parameters<
      typeof normalisePatch
    >[0];
    expect([normalisePatch(junk).ops[0].opLp, normalisePatch(junk).ops[0].opTrack]).toEqual([0, 0]);
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

  it('fills every sync with off, keeps a master, and turns an unknown one off (windsor#646)', () => {
    expect(normalisePatch({}).ops.map((op) => op.sync)).toEqual(['off', 'off', 'off', 'off']);
    const p = normalisePatch({ ops: [{}, { sync: 'note' }, { sync: 'B' }, { sync: 'C' }] });
    expect(p.ops.map((op) => op.sync)).toEqual(['off', 'note', 'B', 'C']);
    const junk = { ops: [{ sync: 'X' }, { sync: 3 }, { sync: 'a' }] } as unknown as Parameters<
      typeof normalisePatch
    >[0];
    expect(normalisePatch(junk).ops.map((op) => op.sync)).toEqual(['off', 'off', 'off', 'off']);
  });

  it('turns off every operator in a sync cycle, one synced to itself included, and keeps one leading into it (windsor#646)', () => {
    const self = normalisePatch({ ops: [{ sync: 'A' }, { sync: 'A' }] });
    expect(self.ops.map((op) => op.sync)).toEqual(['off', 'A', 'off', 'off']);
    const pair = normalisePatch({ ops: [{ sync: 'B' }, { sync: 'A' }, { sync: 'B' }] });
    expect(pair.ops.map((op) => op.sync)).toEqual(['off', 'off', 'B', 'off']);
    const ring = normalisePatch({
      ops: [{ sync: 'D' }, { sync: 'A' }, { sync: 'B' }, { sync: 'C' }],
    });
    expect(ring.ops.map((op) => op.sync)).toEqual(['off', 'off', 'off', 'off']);
  });

  it('fills both LFOs’ ratio depths with 0 and clamps one into −4..4 octaves (windsor#646)', () => {
    expect(normalisePatch({}).lfo.toRatio).toEqual([0, 0, 0, 0]);
    expect(normalisePatch({}).lfo2.toRatio).toEqual([0, 0, 0, 0]);
    const p = normalisePatch({ lfo: { toRatio: [1.5, -9, 9] }, lfo2: { toRatio: [0, 0, 0, -2] } });
    expect(p.lfo.toRatio).toEqual([1.5, -4, 4, 0]);
    expect(p.lfo2.toRatio).toEqual([0, 0, 0, -2]);
  });

  it('keeps a finite number and replaces anything else', () => {
    expect(num(3, 1)).toBe(3);
    expect(num('3', 1)).toBe(1);
    expect(num(NaN, 1)).toBe(1);
    expect(num(Infinity, 2)).toBe(2);
    expect(num(undefined, 0)).toBe(0);
  });
});
