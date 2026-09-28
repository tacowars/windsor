/** The render's frame plan (windsor#40): lengths, and stops on the quantum grid with the song's end among them. */
import { describe, expect, it } from 'vitest';

import { planRender } from './renderPlan';

describe('planRender', () => {
  const plan = planRender({ sampleRate: 48000, leadSeconds: 0.06, songSeconds: 8, tailSeconds: 2 });

  it('sums the lead, the song and the tail in frames', () => {
    expect([plan.leadFrames, plan.songFrames, plan.tailFrames]).toEqual([2880, 384000, 96000]);
    expect(plan.totalFrames).toBe(482880);
    expect(plan.endSeconds).toBeCloseTo(8.06, 12);
  });

  it('steps on the 128-frame grid and stops at the song end, rounded up', () => {
    const stops: number[] = [];
    let now = 0;
    for (let next = plan.nextStop(0, 0.25); next !== null; next = plan.nextStop(now, 0.25)) {
      expect(next).toBeGreaterThan(now);
      stops.push(Math.round(next * 48000));
      now = next;
    }
    expect(stops.every((frame) => frame % 128 === 0)).toBe(true);
    expect(stops).toContain(Math.ceil((8.06 * 48000) / 128) * 128);
    expect(stops.at(-1)!).toBeLessThan(plan.totalFrames);
  });

  it('has no stop left at the end of the render', () => {
    expect(plan.nextStop(plan.totalSeconds, 0.25)).toBeNull();
    const none = planRender({ sampleRate: 44100, leadSeconds: 0, songSeconds: 0, tailSeconds: 0 });
    expect(none.totalFrames).toBe(0);
    expect(none.nextStop(0, 0.25)).toBeNull();
  });
});
