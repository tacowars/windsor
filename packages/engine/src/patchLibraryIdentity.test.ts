/**
 * The #561 migration moved every factory patch from TypeScript into
 * `patches/*.json` with no audible change. This is the proof: the live bank
 * compares against the pre-migration capture (`__fixtures__/patchLibraryBefore561.json`,
 * committed from main before any patch moved) id by id and field by field.
 *
 * `Object.is`, not `toEqual`: `toEqual` treats `-0` and `0` as equal and only
 * hides float drift by accident, and a rounded number is exactly the defect
 * #543 found (a 10.5 dB transient move on `bass-digital`). A leaf that differs
 * is named by its path so the drift is one `git diff` away.
 */
import { describe, expect, it } from 'vitest';

import before from './__fixtures__/patchLibraryBefore561.json';
import { patchLeafDifferences as leafDifferences } from './patchLibrary';
import { PRESET_CATALOG } from './presetCatalog';
import { PRESETS, PRESET_NAMES } from './presets';

describe('the library is bit-identical to the pre-#561 bank', () => {
  it('holds exactly the ids the fixture recorded', () => {
    expect([...PRESET_NAMES].sort()).toEqual([...before.ids].sort());
    expect(Object.keys(PRESETS).sort()).toEqual([...before.ids].sort());
    expect(Object.keys(PRESET_CATALOG).sort()).toEqual([...before.ids].sort());
  });

  it.each(before.ids)('%s: every Patch field is Object.is-identical', (id) => {
    const entry = before.entries[id as keyof typeof before.entries];
    expect(leafDifferences(PRESETS[id], entry.patch, id)).toEqual([]);
  });

  it.each(before.ids)('%s: category, tags and description are unchanged', (id) => {
    const entry = before.entries[id as keyof typeof before.entries];
    const metadata = PRESET_CATALOG[id];
    expect(metadata).toBeDefined();
    expect(Object.is(metadata?.category, entry.category), `${id} category`).toBe(true);
    expect(Object.is(metadata?.description, entry.description), `${id} description`).toBe(true);
    expect(leafDifferences(metadata?.tags, entry.tags, `${id}.tags`)).toEqual([]);
  });

  it('would notice a rounded number, a dropped field or a stray -0', () => {
    const patch = PRESETS['bass-digital'];
    expect(patch).toBeDefined();
    if (!patch) return;
    const expected = before.entries['bass-digital'].patch;
    // One ulp is the smallest drift there is; a rounding is many of them.
    const drifted = structuredClone(patch);
    drifted.ops[1]!.level += Number.EPSILON;
    expect(leafDifferences(drifted, expected)).toHaveLength(1);
    const negativeZero = structuredClone(patch);
    negativeZero.pan = -0;
    expect(leafDifferences(negativeZero, expected)).toEqual(['.pan: -0 ≠ 0']);
    const withoutPitchEnv: Partial<typeof patch> = structuredClone(patch);
    delete withoutPitchEnv.pitchEnv;
    expect(leafDifferences(withoutPitchEnv, expected)).toHaveLength(1);
  });
});
