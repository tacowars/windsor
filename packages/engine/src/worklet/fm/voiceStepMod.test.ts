/**
 * Loading a note's step offsets into the voice (windsor#17, windsor#419):
 * one per target, clamped to -1..1, junk and slots past a short array as 0,
 * and a slide keeps the `slideKeeps` rows.
 */
import { describe, expect, it } from 'vitest';

import type { Voice } from './voice';
import { VOICE_TARGET_COUNT, VOICE_TARGET_TABLE } from './voiceTargetTables';

// `voiceStepMod` reaches `waveTables` through `voiceControl`, which warms the
// wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { loadStepOffsets } = await import('./voiceStepMod');

describe('loadStepOffsets', () => {
  const voice = (): Voice =>
    ({ stepOffsets: new Float64Array(VOICE_TARGET_COUNT) }) as unknown as Voice;

  it('copies the offsets, clamped to -1..1, junk and missing slots as 0', () => {
    const v = voice();
    loadStepOffsets(v, [0.5, 2, -3, Number.NaN], false);
    expect(Array.from(v.stepOffsets.slice(0, 5))).toEqual([0.5, 1, -1, 0, 0]);
    loadStepOffsets(v, undefined, false);
    expect(v.stepOffsets.every((x) => x === 0)).toBe(true);
  });

  it('reads 0 past the end of an array shorter than the table, and for junk', () => {
    const v = voice();
    loadStepOffsets(v, new Array<number>(VOICE_TARGET_COUNT).fill(0.5), false);
    const junk = [0.25, Number.NaN, 'x', null, undefined, Infinity] as unknown as number[];
    loadStepOffsets(v, junk, false);
    expect(Array.from(v.stepOffsets.slice(0, 6))).toEqual([0.25, 0, 0, 0, 0, 1]);
    expect(Array.from(v.stepOffsets.slice(6)).every((x) => x === 0)).toBe(true);
    expect(v.stepOffsets).toHaveLength(VOICE_TARGET_COUNT);
  });

  it('on a slide, keeps the old offset in every slideKeeps row and takes the rest', () => {
    const v = voice();
    loadStepOffsets(v, new Array<number>(VOICE_TARGET_COUNT).fill(0.25), false);
    loadStepOffsets(v, new Array<number>(VOICE_TARGET_COUNT).fill(-0.5), true);
    VOICE_TARGET_TABLE.forEach((r, s) => {
      expect(v.stepOffsets[s], r.path).toBe(r.slideKeeps ? 0.25 : -0.5);
    });
  });
});
