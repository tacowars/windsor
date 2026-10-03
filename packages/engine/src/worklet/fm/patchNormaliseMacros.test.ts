/**
 * The worklet's macros (windsor#559, record `2026-10-04-patch-macro-knobs`
 * decisions 2, 4 and 5): `normalisePatch` keeps at most eight macros with
 * at most eight mappings each, drops a mapping no macro may hold, clamps a
 * value to 0..1 and a mapping's ends to its target row, and reads an
 * unknown curve as Linear, so a song's snapshot never reaches the voice
 * malformed.
 */
import { describe, expect, it } from 'vitest';

import type { PartialPatch } from '../../patch/patch';
import { MACRO_EXP, MACRO_LINEAR, MACRO_S } from './modeIds';
import { MACRO_MAPPINGS_MAX, MACROS_MAX } from './patchDefaults';

// `waveTables` warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { normalisePatch } = await import('./patchNormalise');

const macrosOf = (macros: unknown) => normalisePatch({ macros } as PartialPatch).macros;

describe("the worklet's macros (windsor#559)", () => {
  it('drops a mapping on an unknown target, a macro row, or a target an earlier mapping took', () => {
    const [first, second] = macrosOf([
      {
        mappings: [
          { target: 'filter.cutoff' },
          { target: 'volume' },
          { target: 'macros.1.value' },
          {},
          null,
        ],
      },
      { mappings: [{ target: 'filter.cutoff' }, { target: 'ops.1.level' }] },
    ]);
    expect(first!.mappings.map((m) => m.target)).toEqual(['filter.cutoff']);
    expect(second!.mappings.map((m) => m.target)).toEqual(['ops.1.level']);
  });

  it("clamps min and max to the target row's bounds, and the value to 0..1", () => {
    const [macro, low] = macrosOf([
      { value: 3, mappings: [{ target: 'filter.cutoff', min: 1, max: 1e6, inverted: 1 }] },
      { value: -1 },
    ]);
    expect(macro!.value).toBe(1);
    expect(low!.value).toBe(0);
    expect(macro!.mappings[0]).toEqual({
      target: 'filter.cutoff',
      min: 30,
      max: 18000,
      curve: MACRO_LINEAR,
      inverted: true,
    });
  });

  it('reads a curve outside the ids as Linear, and keeps one inside', () => {
    const curves = [MACRO_EXP, MACRO_S, 9, -1, 'S'].map((curve, i) => ({
      target: `ops.${i % 4}.${i < 4 ? 'level' : 'width'}`,
      curve,
    }));
    const [macro] = macrosOf([{ mappings: curves }]);
    expect(macro!.mappings.map((m) => m.curve)).toEqual([
      MACRO_EXP,
      MACRO_S,
      MACRO_LINEAR,
      MACRO_LINEAR,
      MACRO_LINEAR,
    ]);
  });

  it('keeps at most eight macros and eight mappings, and names a nameless macro', () => {
    const targets = ['level', 'feedback', 'width'].flatMap((f) =>
      [0, 1, 2, 3].map((i) => ({ target: `ops.${i}.${f}` })),
    );
    const macros = macrosOf(Array.from({ length: 10 }, () => ({ mappings: targets })));
    expect(macros).toHaveLength(MACROS_MAX);
    expect(macros[0]!.mappings).toHaveLength(MACRO_MAPPINGS_MAX);
    expect(macros[0]!.name).toBe('Macro');
    // The second macro's first eight targets are the first's: each is dropped.
    expect(macros[1]!.mappings.map((m) => m.target)).toEqual([]);
  });

  it('has none for a patch without, or with junk', () => {
    expect(normalisePatch({}).macros).toEqual([]);
    expect(macrosOf('accent')).toEqual([]);
  });
});
