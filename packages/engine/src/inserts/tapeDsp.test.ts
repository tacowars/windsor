import { describe, expect, it, vi } from 'vitest';
import { loadTape, tapeParams } from '../__fixtures__/tapeHarness';
import { TAPE_BOUNDS, TAPE_TYPES, TAPE_DSP } from './tapeConstants';
import type { TapeSpec } from './tapeSpec';

function render(
  spec: Partial<TapeSpec>,
  options: { rate?: number; hz?: number; level?: number; blocks?: number } = {},
): Float32Array {
  const { rate = 48000, hz = 440, level = 0.3, blocks = 400 } = options;
  const params = tapeParams(spec),
    processor = loadTape(rate, params);
  const input = [new Float32Array(128), new Float32Array(128)];
  const output = [[new Float32Array(128), new Float32Array(128)]];
  const result = new Float32Array(blocks * 128);
  for (let block = 0; block < blocks; block++) {
    for (let i = 0; i < 128; i++)
      input[0]![i] = input[1]![i] = level * Math.sin((2 * Math.PI * hz * (block * 128 + i)) / rate);
    processor.process([input], output, params);
    result.set(output[0]![0]!, block * 128);
  }
  return result;
}
function energy(samples: Float32Array): number {
  let sum = 0;
  for (let i = Math.floor(samples.length / 2); i < samples.length; i++) sum += samples[i]! ** 2;
  return sum / (samples.length / 2);
}

describe('shipped Tape processor', () => {
  it.each([44100, 48000, 96000])(
    'is finite through all models and control extremes at %i Hz',
    (rate) => {
      for (const model of TAPE_TYPES)
        for (const edge of [0, 1] as const) {
          const spec = Object.fromEntries(
            Object.entries(TAPE_BOUNDS).map(([k, v]) => [k, v[edge]]),
          );
          const samples = render(
            { ...spec, model, mix: 1, split: true },
            { rate, level: 4, blocks: 100 },
          );
          expect(samples.every(Number.isFinite)).toBe(true);
          expect(energy(samples)).toBeGreaterThan(0);
        }
    },
  );
  it('has exact stereo dry/bypass, mono duplication, and no dependence on wall clock or Math.random', () => {
    for (const spec of [{ mix: 0 }, { enabled: false }]) {
      const params = tapeParams({ ...spec, wear: 100, hiss: -16, trim: 24 });
      const processor = loadTape(48000, params);
      const l = Float32Array.from({ length: 128 }, (_, i) => i / 128 - 0.5);
      const r = Float32Array.from(l, (v) => -v);
      const out = [[new Float32Array(128), new Float32Array(128)]];
      const random = vi.spyOn(Math, 'random').mockImplementation(() => {
        throw new Error('unseeded DSP');
      });
      const now = vi.spyOn(Date, 'now').mockImplementation(() => {
        throw new Error('wall clock DSP');
      });
      try {
        processor.process([[l, r]], out, params);
        expect(out[0]![0]).toEqual(l);
        expect(out[0]![1]).toEqual(r);
        processor.process([[l]], out, params);
        expect(out[0]![1]).toEqual(l);
      } finally {
        random.mockRestore();
        now.mockRestore();
      }
    }
  });
  it('keeps silence silent with Hiss off, generates seeded hiss with empty input, and stops on disposal', () => {
    const params = tapeParams(),
      processor = loadTape(48000, params);
    const out = [[new Float32Array(128), new Float32Array(128)]];
    processor.process([], out, params);
    expect(out[0]![0]!.every((v) => v === 0)).toBe(true);
    params.hiss![0] = -30;
    for (let i = 0; i < 100; i++) processor.process([], out, params);
    expect(energy(out[0]![0]!)).toBeGreaterThan(0);
    expect(out[0]![1]).toEqual(out[0]![0]);
    processor.port.onmessage({ data: { type: 'stop' } });
    expect(processor.process([], out, params)).toBe(false);
  });
  it('repeats a saved seed, changes with another, and makes wear audible with hiss off', () => {
    const worn = render({ wear: 65, seed: 123 });
    expect(render({ wear: 65, seed: 123 })).toEqual(worn);
    expect(render({ wear: 65, seed: 124 })).not.toEqual(worn);
    expect(render({ wear: 0, seed: 123 })).not.toEqual(worn);
    expect(render({ hiss: -30, seed: 3 }, { level: 0 })).not.toEqual(
      render({ hiss: -30, seed: 4 }, { level: 0 }),
    );
  });
  it('darkens the top with Vintage, brightens with positive Bias, and changes saturation with Drive', () => {
    const studio = render({ drive: -32 }, { hz: 8000, level: 0.03 });
    const vintage = render({ model: 'vintage', drive: -32 }, { hz: 8000, level: 0.03 });
    expect(energy(vintage)).toBeLessThan(energy(studio) / 2);
    const dark = render({ bias: -100, drive: -32 }, { hz: 4000, level: 0.03 });
    const bright = render({ bias: 100, drive: -32 }, { hz: 4000, level: 0.03 });
    expect(energy(bright)).toBeGreaterThan(energy(dark) * 2);
    expect(render({ drive: 24 })).not.toEqual(render({ drive: -24 }));
  });
  it('keeps the left input out of the right channel with hiss disabled', () => {
    const params = tapeParams({ wear: 50 }),
      processor = loadTape(48000, params);
    const out = [[new Float32Array(128), new Float32Array(128)]];
    for (let i = 0; i < 100; i++)
      processor.process([[new Float32Array(128).fill(0.3), new Float32Array(128)]], out, params);
    expect(out[0]![1]!.every((v) => v === 0)).toBe(true);
  });
  it('settles to exact dry after live bypass, including first and last sample of each block', () => {
    const params = tapeParams({ wear: 100, hiss: -16 }),
      processor = loadTape(48000, params);
    const input = [new Float32Array(128).fill(0.1), new Float32Array(128).fill(-0.2)];
    const out = [[new Float32Array(128), new Float32Array(128)]];
    processor.process([input], out, params);
    params.enabled![0] = 0;
    for (let i = 0; i < 200; i++) processor.process([input], out, params);
    expect(out[0]).toEqual(input);
  });
});

it('produces bounded wear delay and actual dropouts, then recovers with zero wear', () => {
  const processor = loadTape(48000, tapeParams({ wear: 100 }));
  const state = processor as unknown as {
    dsp: { motion: { delay: number; dropout: number; tick(wear: number): void } };
  };
  // Exercise the shipped modulation for ten seconds without paying for silent EQ/filter renders.
  const motion = state.dsp.motion;
  let deepest = 0,
    longest = 0,
    lowest = 1;
  for (let sample = 0; sample < 480000; sample++) {
    motion.tick(1);
    deepest = Math.max(deepest, motion.dropout);
    lowest = Math.min(lowest, motion.dropout);
    longest = Math.max(longest, motion.delay);
  }
  expect(lowest).toBeGreaterThanOrEqual(0);
  expect(deepest).toBeGreaterThan(0.1);
  expect(deepest).toBeLessThanOrEqual(1);
  expect(longest).toBeGreaterThan(1);
  expect(longest).toBeLessThanOrEqual(48000 * TAPE_DSP.maxDelaySeconds);
  for (let sample = 0; sample < 240000; sample++) motion.tick(0);
  expect(motion.delay).toBe(0);
  expect(motion.dropout).toBeLessThan(1e-10);
});
it('remains finite during repeated live changes of every control', () => {
  const params = tapeParams(),
    processor = loadTape(44100, params);
  const out = [[new Float32Array(128), new Float32Array(128)]];
  const input = [new Float32Array(128).fill(1), new Float32Array(128).fill(-1)];
  for (let block = 0; block < 500; block++) {
    const edge = block % 2;
    for (const [key, bounds] of Object.entries(TAPE_BOUNDS)) params[key]![0] = bounds[edge]!;
    params.model![0] = block % TAPE_TYPES.length;
    processor.process([input], out, params);
    expect(out[0]!.every((channel) => channel.every(Number.isFinite))).toBe(true);
  }
});
