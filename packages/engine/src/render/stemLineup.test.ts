/**
 * The stem passes' lineup check (windsor#41): a master that differs only by
 * float rounding still lines up; one moved by a whole quantum, or by less
 * than one — a transient moved within its block — does not.
 */
import { describe, expect, it } from 'vitest';

import {
  RENDER_QUANTUM_FRAMES,
  RENDER_STEM_LINEUP_CHUNK_FRAMES,
  RENDER_STEM_LINEUP_TOLERANCE,
} from './renderConstants';
import { linesUp, masterDrift } from './stemLineup';

/** A decaying burst every 1000 frames, both channels. */
function master(frames = 8000): Float32Array[] {
  const channel = Float32Array.from(
    { length: frames },
    (_, i) => Math.sin(i * 0.3) * Math.exp(-(i % 1000) / 150),
  );
  return [channel, channel.slice()];
}

/** Silence with one full-scale click at `frame`, both channels. */
function click(frame: number, frames = 8 * RENDER_QUANTUM_FRAMES): Float32Array[] {
  const channel = new Float32Array(frames);
  channel[frame] = 1;
  return [channel, channel.slice()];
}

describe('the stem pass lineup', () => {
  it('holds for a master that differs by rounding (the 1.0e-6 Chrome shows)', async () => {
    const a = master();
    const b = a.map((c) => c.map((s, i) => s + (i % 2 ? 1e-6 : -1e-6)));
    expect(await masterDrift(a, b)).toBeLessThan(RENDER_STEM_LINEUP_TOLERANCE);
    expect(await linesUp(a, b)).toBe(true);
  });

  it('refuses an isolated transient moved within one quantum', async () => {
    const block = 3 * RENDER_QUANTUM_FRAMES;
    const early = click(block);
    // Same block, same magnitude summed over it: only its frame differs.
    const late = click(block + RENDER_QUANTUM_FRAMES - 1);
    expect(await masterDrift(early, late)).toBe(1);
    expect(await linesUp(early, late)).toBe(false);
    // One frame is enough.
    expect(await linesUp(early, click(block + 1))).toBe(false);
  });

  it('refuses real audio a whole quantum late, a frame late, or a note louder', async () => {
    const a = master();
    const blockLate = a.map((c) => c.slice().copyWithin(RENDER_QUANTUM_FRAMES, 0));
    expect(await linesUp(a, blockLate)).toBe(false);
    const frameLate = a.map((c) => c.slice().copyWithin(1, 0));
    // Orders of magnitude past the tolerance, not a near miss.
    expect(await masterDrift(a, frameLate)).toBeGreaterThan(1e3 * RENDER_STEM_LINEUP_TOLERANCE);
    const louder = a.map((c) => c.map((s, i) => (i >= 3000 && i < 4000 ? s * 1.01 : s)));
    expect(await linesUp(a, louder)).toBe(false);
  });

  it('refuses a master of another length or channel count', async () => {
    const a = master();
    expect(
      await masterDrift(
        a,
        a.map((c) => c.subarray(1)),
      ),
    ).toBe(Infinity);
    expect(await linesUp(a, [a[0]!])).toBe(false);
  });

  it('compares in chunks, the same drift whatever the chunk', async () => {
    const a = master();
    const late = a.map((c) => c.slice().copyWithin(1, 0));
    const whole = await masterDrift(a, late, { chunkFrames: 1e6 });
    let yields = 0;
    const chunked = await masterDrift(a, late, {
      chunkFrames: 100,
      yieldToLoop: async () => void yields++,
    });
    expect(chunked).toBe(whole);
    expect(yields).toBe(80);
    expect(RENDER_STEM_LINEUP_CHUNK_FRAMES).toBe(65536);
  });

  it('rejects with an AbortError between chunks once cancelled', async () => {
    const a = master();
    const controller = new AbortController();
    let yields = 0;
    const run = masterDrift(a, a, {
      chunkFrames: 100,
      signal: controller.signal,
      yieldToLoop: async () => {
        if (++yields === 3) controller.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(yields).toBe(3);
  });

  it('refuses a chunk that is not a positive integer', async () => {
    const a = master(10);
    for (const chunkFrames of [0, -1, NaN, 2.5]) {
      await expect(masterDrift(a, a, { chunkFrames })).rejects.toThrow(
        new RangeError(`chunkFrames must be a positive integer, got ${chunkFrames}`),
      );
    }
  });
});
