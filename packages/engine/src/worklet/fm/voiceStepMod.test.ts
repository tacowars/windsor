/**
 * Loading a note's step offsets into the voice (windsor#17): clamped to
 * -1..1, junk as 0, and a slide keeps the `slideKeeps` rows.
 */
import { describe, expect, it } from 'vitest';

import { STEP_MOD_SLOT_COUNT, STEP_MOD_TABLE } from './stepModTables';
import type { Voice } from './voice';

// `voiceStepMod` reaches `waveTables` through `voiceControl`, which warms the
// wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { loadStepOffsets } = await import('./voiceStepMod');

describe('loadStepOffsets', () => {
  const voice = (): Voice =>
    ({ stepOffsets: new Float64Array(STEP_MOD_SLOT_COUNT) }) as unknown as Voice;

  it('copies the offsets, clamped to -1..1, junk and missing slots as 0', () => {
    const v = voice();
    loadStepOffsets(v, [0.5, 2, -3, Number.NaN], false);
    expect(Array.from(v.stepOffsets.slice(0, 5))).toEqual([0.5, 1, -1, 0, 0]);
    loadStepOffsets(v, undefined, false);
    expect(v.stepOffsets.every((x) => x === 0)).toBe(true);
  });

  it('on a slide, keeps the old offset in every slideKeeps row and takes the rest', () => {
    const v = voice();
    loadStepOffsets(v, new Array<number>(STEP_MOD_SLOT_COUNT).fill(0.25), false);
    loadStepOffsets(v, new Array<number>(STEP_MOD_SLOT_COUNT).fill(-0.5), true);
    STEP_MOD_TABLE.forEach((r, s) => {
      expect(v.stepOffsets[s], r.param).toBe(r.slideKeeps ? 0.25 : -0.5);
    });
  });
});
