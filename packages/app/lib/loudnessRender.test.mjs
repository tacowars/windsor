/**
 * The quick clip check against the real DSP (#563): `LOUDNESS_RENDER` played
 * through the worklet in Node, and for a patch that really clips the
 * suggested volume really brings the worst seed under the line. Lives beside
 * the `.mjs` tests because the Node-side worklet harness cannot enter the
 * editor's DOM-typed source tree.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor, render } from '../../engine/src/__fixtures__/workletHarness';
import { clonePatch } from '../../engine/src/index';
import { PATCH_LIBRARY } from '../../engine/src/patch/presets';
import { LOUDNESS_RENDER, LOUDNESS_SEEDS } from '../src/libraryConstants';
import { loudnessVerdict } from '../src/loudnessCheck';

const dsp = loadProcessor();

/** The check's render at one seed, as the browser's offline render plays it: its peak sample. */
function peakAt(patch, seed) {
  const events = [
    {
      type: 'noteOn',
      id: 1,
      note: LOUDNESS_RENDER.note,
      velocity: LOUDNESS_RENDER.velocity,
      frame: 0,
    },
    { type: 'noteOff', id: 1, frame: LOUDNESS_RENDER.noteOffFrame },
  ];
  const result = render(
    dsp,
    dsp.create(patch, LOUDNESS_RENDER.voices, seed),
    LOUDNESS_RENDER.blocks,
    events,
    { collectSamples: false },
  );
  if (result.nonFinite) throw new Error(`${patch.name}: non-finite output at seed ${seed}`);
  return result.peak;
}

describe('the check render', () => {
  it('runs at the harness rate and block, the ones an OfflineAudioContext uses', () => {
    expect(LOUDNESS_RENDER.sampleRate).toBe(dsp.sampleRate);
    // The harness renders 128-frame blocks (`BLOCK` in workletHarness.ts), the
    // Web Audio render quantum an OfflineAudioContext uses too.
    expect(LOUDNESS_RENDER.blockFrames).toBe(128);
  });
});

describe('a clipping patch', () => {
  it('gets a warning whose suggested volume brings the worst seed under the line', () => {
    // No filter drive, so its peak is linear in `volume` and doubling it
    // clips on every seed.
    const patch = clonePatch(PATCH_LIBRARY['weapon-zap'].patch);
    patch.volume *= 2;
    const peaks = Array.from({ length: LOUDNESS_SEEDS }, (_, seed) => ({
      seed,
      peak: peakAt(patch, seed),
    }));
    const verdict = loudnessVerdict(patch, peaks);
    expect(verdict.clips).toBe(true);
    expect(verdict.peak).toBeGreaterThan(1);
    expect(verdict.seeds).toBe(LOUDNESS_SEEDS);
    expect(verdict.worstSeed).toBe(peaks.reduce((a, b) => (b.peak > a.peak ? b : a)).seed);
    expect(verdict.suggestedVolume).toBeCloseTo((patch.volume * 0.98) / verdict.peak, 12);
    const trimmed = clonePatch(patch);
    trimmed.volume = verdict.suggestedVolume;
    expect(peakAt(trimmed, verdict.worstSeed)).toBeLessThanOrEqual(1);
  });

  it('gets no warning at its shipped volume', () => {
    const patch = PATCH_LIBRARY['weapon-zap'].patch;
    const peaks = Array.from({ length: LOUDNESS_SEEDS }, (_, seed) => ({
      seed,
      peak: peakAt(patch, seed),
    }));
    expect(loudnessVerdict(patch, peaks).clips).toBe(false);
  });
});
