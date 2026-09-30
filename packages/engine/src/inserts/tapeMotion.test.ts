import { expect, it } from 'vitest';
import { loadTape, tapeParams } from '../__fixtures__/tapeHarness';

// Inspect the shipped processor; importing worklet source would bypass its TS project boundary.
interface TapeState {
  left: number;
  right: number;
  weights: Float64Array;
  motion: { delay: number; dropout: number; wowClock: number };
  tick(left: number, right: number): void;
  configure(params: Record<string, Float32Array>, frames: number): void;
}

function state(spec = {}) {
  const params = tapeParams(spec),
    processor = loadTape(48000, params);
  return { params, processor, dsp: (processor as unknown as { dsp: TapeState }).dsp };
}

it.each(['wow', 'flutter', 'dropouts'] as const)(
  'isolates %s from the other transport effects',
  (field) => {
    const { dsp } = state({ split: true, [field]: 100, seed: 123 });
    let delay = 0,
      dropout = 0;
    for (let i = 0; i < 48000 * 5; i++) {
      dsp.tick(0, 0);
      delay = Math.max(delay, dsp.motion.delay);
      dropout = Math.max(dropout, dsp.motion.dropout);
      expect(dsp.left).toBe(0);
    }
    if (field === 'dropouts') {
      expect(delay).toBe(0);
      expect(dropout).toBeGreaterThan(0.1);
    } else {
      expect(delay).toBeGreaterThan(1);
      expect(dropout).toBe(0);
    }
  },
);

it('makes both motion rates effective with their independent amount enabled', () => {
  for (const field of ['wow', 'flutter'] as const) {
    const a = state({ split: true, [field]: 50, [`${field}Rate`]: 1 }).dsp;
    const b = state({ split: true, [field]: 50, [`${field}Rate`]: 3 }).dsp;
    let differences = 0;
    for (let i = 0; i < 48000 * 2; i++) {
      const sample = Math.sin(i * 0.057) * 0.2;
      a.tick(sample, sample);
      b.tick(sample, sample);
      if (a.left !== b.left) differences++;
    }
    expect(differences).toBeGreaterThan(1000);
  }
});

it('keeps a running legacy sound identical when its macro is materialized at equal amounts', () => {
  const a = state({ wear: 63 }),
    b = state({ wear: 63 });
  for (let i = 0; i < 48000; i++) {
    a.dsp.tick(0.1, -0.2);
    b.dsp.tick(0.1, -0.2);
  }
  const split = tapeParams({ wear: 63, split: true, wow: 63, flutter: 63, dropouts: 63 });
  b.dsp.configure(split, 128);
  a.dsp.configure(a.params, 128);
  for (let i = 0; i < 48000; i++) {
    a.dsp.tick(0.1, -0.2);
    b.dsp.tick(0.1, -0.2);
    expect(b.dsp.left).toBe(a.dsp.left);
    expect(b.dsp.right).toBe(a.dsp.right);
  }
});

it('applies a live rate increase without waiting for the previous slow interval', () => {
  const { dsp, params } = state({ split: true, wow: 50, wowRate: 0.05 });
  dsp.tick(0, 0);
  expect(dsp.motion.wowClock).toBeGreaterThan(48000 * 19);
  params.wowRate![0] = 3;
  dsp.configure(params, 128);
  for (let i = 0; i < 4800; i++) dsp.tick(0, 0);
  expect(dsp.motion.wowClock).toBeLessThan(48000 / 3);
});

it('fades inactive model banks out, then safely reactivates and rapidly changes models', () => {
  const { dsp, params } = state();
  params.model![0] = 6;
  dsp.configure(params, 128);
  for (let i = 0; i < 48000; i++) dsp.tick(0.1, -0.2);
  expect([...dsp.weights]).toEqual([0, 0, 0, 0, 0, 0, 1]);
  for (let block = 0; block < 100; block++) {
    params.model![0] = block % 7;
    dsp.configure(params, 128);
    for (let i = 0; i < 128; i++) {
      dsp.tick(0.1, -0.2);
      expect(Number.isFinite(dsp.left) && Number.isFinite(dsp.right)).toBe(true);
      expect(Math.abs(dsp.left)).toBeLessThan(1);
    }
  }
});
