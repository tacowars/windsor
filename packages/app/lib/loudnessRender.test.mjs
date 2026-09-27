/**
 * The quick clip check against the real DSP (#563): its render is the
 * headroom test's render with fewer seeds, and for a patch that really clips
 * the suggested volume really brings the worst seed under the line. Lives
 * beside the `.mjs` tests because the Node-side render fixture cannot enter
 * the editor's DOM-typed source tree.
 */
import { describe, expect, it } from 'vitest';

import {
  HEADROOM_RENDER,
  peakAt,
} from '../../../packages/client/src/audio/__fixtures__/headroomSweep';
import { loadProcessor } from '../../../packages/client/src/audio/__fixtures__/workletHarness';
import { PATCH_LIBRARY, clonePatch } from '../../../packages/client/src/audio/index-for-editor';
import { LOUDNESS_RENDER, LOUDNESS_SEEDS } from '../src/libraryConstants';
import { loudnessVerdict } from '../src/loudnessCheck';

const dsp = loadProcessor();

describe('the check render', () => {
  it('is the headroom test render, seed count aside', () => {
    expect(LOUDNESS_RENDER.voices).toBe(HEADROOM_RENDER.voices);
    expect(LOUDNESS_RENDER.blocks).toBe(HEADROOM_RENDER.blocks);
    expect(LOUDNESS_RENDER.note).toBe(HEADROOM_RENDER.note);
    expect(LOUDNESS_RENDER.velocity).toBe(HEADROOM_RENDER.velocity);
    expect(LOUDNESS_RENDER.noteOffFrame).toBe(HEADROOM_RENDER.noteOffFrame);
    expect(LOUDNESS_RENDER.sampleRate).toBe(dsp.sampleRate);
    // The harness renders 128-frame blocks (`BLOCK` in workletHarness.ts), the
    // Web Audio render quantum an OfflineAudioContext uses too.
    expect(LOUDNESS_RENDER.blockFrames).toBe(128);
  });
});

describe('a clipping patch', () => {
  it('gets a warning whose suggested volume brings the worst seed under the line', () => {
    // The historical clipping patch (`fmProcessorHeadroom.test.ts`): no filter
    // drive, so its peak is linear in `volume` and doubling it clips on every seed.
    const patch = clonePatch(PATCH_LIBRARY['weapon-zap'].patch);
    patch.volume *= 2;
    const peaks = Array.from({ length: LOUDNESS_SEEDS }, (_, seed) => ({
      seed,
      peak: peakAt(dsp, patch, seed),
    }));
    const verdict = loudnessVerdict(patch, peaks);
    expect(verdict.clips).toBe(true);
    expect(verdict.peak).toBeGreaterThan(1);
    expect(verdict.seeds).toBe(LOUDNESS_SEEDS);
    expect(verdict.worstSeed).toBe(peaks.reduce((a, b) => (b.peak > a.peak ? b : a)).seed);
    expect(verdict.suggestedVolume).toBeCloseTo((patch.volume * 0.98) / verdict.peak, 12);
    const trimmed = clonePatch(patch);
    trimmed.volume = verdict.suggestedVolume;
    expect(peakAt(dsp, trimmed, verdict.worstSeed)).toBeLessThanOrEqual(1);
  });
});
