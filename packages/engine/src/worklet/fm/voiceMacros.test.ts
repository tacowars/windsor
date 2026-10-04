/**
 * A macro's arithmetic (windsor#560, record `2026-10-04-patch-macro-knobs`
 * decisions 2–4): the compiled tables a patch carries, each curve and its
 * inversion at x = 0.25, the geometric sweep on a ratio row, a ratio end
 * below the floor raised to it, and a step's push over the mapped base.
 */
import { describe, expect, it } from 'vitest';

import type { PartialMacroMapping, Patch } from '../../patch/patch';
import { MACRO_CURVE, makeMacro, makePatch } from '../../patch/patch';
import type { WorkletPatch } from './patchNormalise';
import { VOICE_TARGET_COUNT, VT_MACRO_BASE, voiceTargetCode } from './voiceTargetTables';

// `patchNormalise` reaches the wave cache, which reads the scope's sample rate at load.
Object.assign(globalThis, { sampleRate: 48000 });
const { compileMacros, applyMacroBases } = await import('./voiceMacros');
const { normalisePatch } = await import('./patchNormalise');

const LEVEL = voiceTargetCode('ops.0.level');
const CUTOFF = voiceTargetCode('filter.cutoff');
const DECAY = voiceTargetCode('ops.1.env.decayTime');

/** A worklet patch whose macros are `macros`, each a list of mappings. */
const compiled = (...macros: PartialMacroMapping[][]): WorkletPatch =>
  compileMacros(normalisePatch(makePatch({ macros: macros.map((mappings) => ({ mappings })) })));

/** What `patch`'s mappings write with macro `i` at `values[i]` and `pushes` (by code). */
function bases(patch: WorkletPatch, values: number[], pushes: number[] = []): Float64Array {
  const src = new Float64Array(VOICE_TARGET_COUNT);
  values.forEach((v, i) => (src[VT_MACRO_BASE + i] = v));
  const push = new Float64Array(VOICE_TARGET_COUNT);
  pushes.forEach((p, k) => (push[k] = p));
  const dst = new Float64Array(VOICE_TARGET_COUNT).fill(NaN);
  applyMacroBases(patch, src, dst, push);
  return dst;
}

describe('compileMacros', () => {
  it('compiles a patch without macros to a count of 0 and nothing mapped', () => {
    const patch = compileMacros(normalisePatch({}));
    expect(patch.macroMapCount).toBe(0);
    expect(patch.macroMapped.every((m) => m === 0)).toBe(true);
  });

  it('lays each mapping out by code, its macro by row, and marks its target', () => {
    const patch = compiled(
      [{ target: 'ops.0.level', min: 0.2, max: 0.8 }],
      [{ target: 'filter.cutoff', min: 200, max: 3200, curve: MACRO_CURVE.S, inverted: true }],
    );
    expect(patch.macroMapCount).toBe(2);
    expect(Array.from(patch.macroMapTarget.subarray(0, 2))).toEqual([LEVEL, CUTOFF]);
    expect(Array.from(patch.macroMapMacro.subarray(0, 2))).toEqual([
      VT_MACRO_BASE,
      VT_MACRO_BASE + 1,
    ]);
    expect(patch.macroMapSpan[0]).toBeCloseTo(0.6, 15);
    expect(patch.macroMapSpan[1]).toBeCloseTo(4, 12); // log2(3200 / 200)
    expect(patch.macroMapCurve[1]).toBe(MACRO_CURVE.S);
    expect(patch.macroMapInverted[1]).toBe(1);
    expect(patch.macroMapped[LEVEL]).toBe(1);
    expect(patch.macroMapped[CUTOFF]).toBe(1);
    expect(patch.macroMapped.reduce((a, m) => a + m, 0)).toBe(2);
  });

  it('raises a ratio end below the floor to it, so the sweep never takes log2(0)', () => {
    const patch: Patch = makePatch({
      macros: [makeMacro({ mappings: [{ target: 'ops.1.env.decayTime', max: 2 }] })],
    });
    patch.macros[0]!.mappings[0]!.min = 0;
    const out = compileMacros(patch);
    expect(out.macroMapMin[0]).toBe(0.001);
    expect(bases(out, [0])[DECAY]).toBe(0.001);
    expect(Number.isFinite(out.macroMapSpan[0])).toBe(true);
  });
});

describe('applyMacroBases', () => {
  const at = 0.25;
  const curves: [string, number, number, number][] = [
    ['Linear', MACRO_CURVE.LINEAR, 0.25, 0.75],
    ['Exp', MACRO_CURVE.EXP, 0.015625, 0.421875],
    ['Log', MACRO_CURVE.LOG, 0.578125, 0.984375],
    ['S', MACRO_CURVE.S, 0.15625, 0.84375],
  ];

  it.each(curves)(
    '%s at x = 0.25 gives its shape, and inverted its shape at 0.75',
    (_n, curve, up, down) => {
      const one = (inverted: boolean): number =>
        bases(compiled([{ target: 'ops.0.level', min: 0, max: 1, curve, inverted }]), [at])[LEVEL]!;
      expect(one(false)).toBe(up);
      expect(one(true)).toBe(down);
    },
  );

  it('sweeps a ratio row geometrically, from min at 0 to max at 1', () => {
    const patch = compiled([{ target: 'filter.cutoff', min: 200, max: 3200 }]);
    expect(bases(patch, [0])[CUTOFF]).toBe(200);
    expect(bases(patch, [0.5])[CUTOFF]).toBe(800);
    expect(bases(patch, [1])[CUTOFF]).toBeCloseTo(3200, 9);
  });

  it("pushes a step over the mapped base in the row's curve, clamped", () => {
    const patch = compiled([
      { target: 'ops.0.level', min: 0.2, max: 0.6 },
      { target: 'filter.cutoff', min: 200, max: 3200 },
    ]);
    const pushes: number[] = [];
    pushes[LEVEL] = 0.5; // × span 0.5
    pushes[CUTOFF] = 1 / 4.5; // one octave of the row's 4.5
    const out = bases(patch, [0.5], pushes);
    expect(out[LEVEL]).toBeCloseTo(0.65, 15);
    expect(out[CUTOFF]).toBeCloseTo(1600, 9);
    pushes[LEVEL] = 1;
    expect(bases(patch, [1], pushes)[LEVEL]).toBe(1);
  });

  it('writes only the mapped targets, each from its own macro', () => {
    const patch = compiled(
      [{ target: 'ops.0.level' }],
      [{ target: 'filter.cutoff', min: 100, max: 400 }],
    );
    const out = bases(patch, [0.75, 0.5]);
    expect(out[LEVEL]).toBe(0.75);
    expect(out[CUTOFF]).toBeCloseTo(200, 12);
    expect(Array.from(out).filter((v) => !Number.isNaN(v))).toHaveLength(2);
  });
});
