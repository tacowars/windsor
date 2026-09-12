/** Long-note checks complement the short seeded headroom sweep. Real worklet, dry output. */
import { describe, expect, it } from 'vitest';
import { loadProcessor, render } from './__fixtures__/workletHarness';
import { SCORING_CATALOG } from './presetsScoring';

const dsp = loadProcessor();
const BLOCK = 128;
describe('scoring bank sustain and release', () => {
  it.each(SCORING_CATALOG)(
    '$id is finite and audible through its envelope and release',
    ({ patch, category }) => {
      const hold = Math.max(
        ...patch.ops.map((op) => op.env.attackTime + op.env.decayTime),
        patch.filter.env.attackTime + patch.filter.env.decayTime,
        2,
      );
      const tail = Math.max(...patch.ops.map((op) => op.env.releaseTime)) + 0.1;
      const frames = Math.ceil(hold * dsp.sampleRate);
      const blocks = Math.ceil(((hold + tail) * dsp.sampleRate) / BLOCK);
      const notes = category === 'Basses' ? [24, 36, 48] : [36, 60, 84];
      for (const note of notes) {
        const processor = dsp.create(patch, 16, 0xa204);
        const result = render(
          dsp,
          processor,
          blocks,
          [
            { type: 'noteOn', id: 1, note, velocity: 1, frame: 0 },
            { type: 'noteOff', id: 1, frame: frames },
          ],
          { collectSamples: false },
        );
        expect(result.nonFinite, `note ${note}`).toBe(0);
        expect(result.peak, `note ${note}`).toBeGreaterThan(0.002);
        expect(result.peak, `note ${note}`).toBeLessThan(0.8);
        expect(
          processor.voices.filter((voice) => voice.active),
          `note ${note} releases`,
        ).toHaveLength(0);
      }
    },
  );
  it.each(
    SCORING_CATALOG.filter((entry) => ['Strings', 'Pads', 'Plucks'].includes(entry.category)),
  )('$id keeps headroom for a four-note chord', ({ patch }) => {
    const seconds = Math.max(...patch.ops.map((op) => op.env.attackTime + op.env.decayTime), 2);
    const events = [48, 55, 60, 63].map((note, id) => ({
      type: 'noteOn' as const,
      id,
      note,
      velocity: 1,
      frame: 0,
    }));
    const result = render(
      dsp,
      dsp.create(patch, 16),
      Math.ceil((seconds * dsp.sampleRate) / BLOCK),
      events,
      { collectSamples: false },
    );
    expect(result.nonFinite).toBe(0);
    expect(result.peak).toBeGreaterThan(0.002);
    expect(result.peak).toBeLessThan(1);
  });
});
