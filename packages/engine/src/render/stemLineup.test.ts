/**
 * The stem passes' lineup check (windsor#41): a master that differs only by
 * float rounding still lines up; one a block late, or a note louder, does not.
 */
import { describe, expect, it } from 'vitest';

import { RENDER_QUANTUM_FRAMES } from './renderConstants';
import { blockEnvelope, envelopesMatch } from './stemLineup';

/** A decaying burst every 1000 frames, both channels. */
function master(frames = 8000): Float32Array[] {
  const channel = Float32Array.from(
    { length: frames },
    (_, i) => Math.sin(i * 0.3) * Math.exp(-(i % 1000) / 150),
  );
  return [channel, channel.slice()];
}

describe('the stem pass lineup', () => {
  it('sums |sample| per render quantum, channel by channel', () => {
    const channel = new Float32Array(RENDER_QUANTUM_FRAMES + 2).fill(-0.5);
    expect([...blockEnvelope([channel, channel.map(() => 1)])]).toEqual([
      RENDER_QUANTUM_FRAMES / 2,
      1,
      RENDER_QUANTUM_FRAMES,
      2,
    ]);
  });

  it('holds for a master that differs by rounding (the 1.0e-6 Chrome shows)', () => {
    const a = master();
    const b = a.map((c) => c.map((s, i) => s + (i % 2 ? 1e-6 : -1e-6)));
    expect(envelopesMatch(blockEnvelope(a), blockEnvelope(b))).toBe(true);
  });

  it('fails for a master a block late, or one note louder', () => {
    const a = master();
    const late = a.map((c) => c.slice().copyWithin(RENDER_QUANTUM_FRAMES, 0));
    expect(envelopesMatch(blockEnvelope(a), blockEnvelope(late))).toBe(false);
    const louder = a.map((c) => c.map((s, i) => (i >= 3000 && i < 4000 ? s * 1.01 : s)));
    expect(envelopesMatch(blockEnvelope(a), blockEnvelope(louder))).toBe(false);
    expect(envelopesMatch(blockEnvelope(a), blockEnvelope(a.map((c) => c.subarray(1))))).toBe(
      false,
    );
  });
});
