/**
 * The capture path through the whole system (windsor#75, over windsor#74's
 * per-region `ArrangementPlayer.capturePattern`): `AudioSystem.capturePattern`
 * forwards the region index, so the console's Euclid card captures the
 * figure the selected region plays, not the part's own.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import {
  FULL_DOCUMENT,
  FULL_PARTS,
  FULL_SLOT,
  withDocumentPart,
} from '../__fixtures__/fullArrangement';
import { halves, patternOf } from '../__fixtures__/regionPatternSongs';
import type { RegionPattern } from '../song/arrangement';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from './audioSystem';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

describe('AudioSystem.capturePattern', () => {
  it("forwards the region index: region 2's figure, and the part's own with no index", async () => {
    const kick = patternOf(FULL_PARTS.kick.sequencer);
    const fixed: RegionPattern = { ...kick, pattern: Array.from({ length: 16 }, (_, i) => i < 2) };
    const doc = withDocumentPart(FULL_DOCUMENT, 'kick', { regions: halves(undefined, fixed) });
    const system = new AudioSystem(new FmEngine(new FakeContext().asAudioContext()));
    await system.init();
    system.initMusic(doc);
    const slot = FULL_SLOT.kick;
    expect(system.capturePattern(slot, 1)).toEqual(fixed.kind === 'euclidean' && fixed.pattern);
    expect(system.capturePattern(slot, 0)).toEqual(system.capturePattern(slot));
    expect(system.capturePattern(slot, 0)).not.toEqual(system.capturePattern(slot, 1));
    expect(system.capturePattern(FULL_SLOT.drone, 1)).toBeNull();
  });
});
