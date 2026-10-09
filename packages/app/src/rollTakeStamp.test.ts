/** The heard time of a played note (windsor#662): the output reading, and the fallback without one. */
import { describe, expect, it } from 'vitest';
import { heardContextTime } from './rollTakeStamp';

describe('heardContextTime', () => {
  it('maps the event through the output reading, less the output latency', () => {
    const output = { contextTime: 12.5, performanceTime: 4000 };
    const at = heardContextTime(4030, { output, outputLatency: 0.02, currentTime: 13 });
    expect(at).toBeCloseTo(12.51, 9);
  });

  it('falls back to the context clock with no reading, or a zero one', () => {
    for (const output of [undefined, {}, { contextTime: 0, performanceTime: 0 }]) {
      const at = heardContextTime(4030, { output, outputLatency: 0.02, currentTime: 13 });
      expect(at).toBeCloseTo(12.98, 9);
    }
    expect(
      heardContextTime(4030, { output: undefined, outputLatency: undefined, currentTime: 13 }),
    ).toBe(13);
  });
});
