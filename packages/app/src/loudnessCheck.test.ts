/**
 * The quick clip check's pure parts (#563): the buffer peak, the verdict from
 * measured peaks and the worklet data URL. The real-render assertions — a
 * clipping patch warns, and its suggested volume brings it under the line —
 * are `lib/loudnessRender.test.mjs`, which can load the Node-side worklet
 * harness this DOM-typed tree cannot.
 */
import { describe, expect, it } from 'vitest';

import { makePatch } from '@windsor/engine';
import { LOUDNESS_SEEDS, SUGGESTED_HEADROOM } from './libraryConstants';
import { loudnessVerdict, peakOf } from './loudnessCheck';

describe('the verdict', () => {
  it('reads a buffer peak across channels', () => {
    const buffer = {
      numberOfChannels: 2,
      getChannelData: (c: number) => new Float32Array(c === 0 ? [0.1, -0.4] : [0.2, 0.9]),
    };
    expect(peakOf(buffer)).toBeCloseTo(0.9, 6);
  });

  it('names the worst seed, the peak and volume × 0.98 / peak when it clips', () => {
    const patch = makePatch({ volume: 0.5 });
    const peaks = [
      { seed: 0, peak: 0.8 },
      { seed: 1, peak: 1.25 },
      { seed: 2, peak: 1.1 },
    ];
    const verdict = loudnessVerdict(patch, peaks);
    expect(verdict).toEqual({
      peak: 1.25,
      worstSeed: 1,
      seeds: 3,
      clips: true,
      suggestedVolume: (0.5 * SUGGESTED_HEADROOM) / 1.25,
    });
    expect(LOUDNESS_SEEDS).toBe(16);
  });

  it('is quiet under the line', () => {
    const verdict = loudnessVerdict(makePatch(), [{ seed: 0, peak: 0.7 }]);
    expect(verdict.clips).toBe(false);
    expect(verdict.suggestedVolume).toBeNull();
  });
});
