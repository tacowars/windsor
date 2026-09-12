/** Node-only real-DSP sweep shared by the offline measurement command. */
import { loadProcessor, render } from './workletHarness';
import { SCORING_CATALOG } from '../presetsScoring';

export function sweep(seeds: number): Record<string, { seed: number; peak: number }> {
  const dsp = loadProcessor();
  const results: Record<string, { seed: number; peak: number }> = {};
  for (const { id, patch } of SCORING_CATALOG) {
    let worst = { seed: 0, peak: 0 };
    for (let seed = 0; seed < seeds; seed++) {
      const result = render(
        dsp,
        dsp.create(patch, 16, seed),
        400,
        [
          { type: 'noteOn', id: 1, note: 60, velocity: 0.9, frame: 0 },
          { type: 'noteOff', id: 1, frame: 12000 },
        ],
        { collectSamples: false },
      );
      if (result.nonFinite || result.peak > 1)
        throw new Error(`${id}: invalid output at ${seed}: ${result.peak}`);
      if (result.peak > worst.peak) worst = { seed, peak: result.peak };
    }
    results[id] = worst;
  }
  return results;
}
