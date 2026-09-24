import { expect, it } from 'vitest';
import { loadPhaser, phaserParams } from '../__fixtures__/phaserHarness';
import type { PhaserSpec } from './phaserSpec';
import { PHASER_BOUNDS, PHASER_DSP } from './phaserConstants';

function render(spec: Partial<PhaserSpec>, hz: number, rate = 48000) {
  const params = phaserParams(spec);
  const processor = loadPhaser(rate, params);
  const input = new Float32Array(128);
  const output = [[new Float32Array(128), new Float32Array(128)]];
  const left: number[] = [],
    right: number[] = [];
  for (let block = 0; block < Math.ceil(rate / 128); block++) {
    for (let i = 0; i < input.length; i++)
      input[i] = 0.1 * Math.sin((2 * Math.PI * hz * (block * 128 + i)) / rate);
    processor.process([[input]], output, params);
    left.push(...output[0]![0]!);
    right.push(...output[0]![1]!);
  }
  return { left, right };
}
const rms = (values: number[]): number =>
  Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length);
const lateRms = (values: number[]): number => rms(values.slice(values.length / 2));

it('keeps wet history running during bypass without crossing stereo audio channels', () => {
  const live = phaserParams({ stereo: 120, feedback: 0.7 });
  const bypass = phaserParams({ stereo: 120, feedback: 0.7, enabled: false });
  const a = loadPhaser(48000, live),
    b = loadPhaser(48000, bypass);
  const input = [[new Float32Array(128).fill(0.2), new Float32Array(128)]];
  const outA = [[new Float32Array(128), new Float32Array(128)]];
  const outB = [[new Float32Array(128), new Float32Array(128)]];
  for (let block = 0; block < 800; block++) {
    if (block === 400) bypass.enabled![0] = 1;
    a.process(input, outA, live);
    b.process(input, outB, bypass);
  }
  expect(outA).toEqual(outB);
  expect(outA[0]![1]).toEqual(new Float32Array(128));
});

it.each([44100, 48000, 96000])('has the classic four-stage two-notch response at %i Hz', (rate) => {
  const center = 700;
  const settings = { center, depth: 0, envelope: 0, feedback: 0, bassKeep: 0, mix: 0.5 };
  for (const angle of [Math.PI / 8, (3 * Math.PI) / 8]) {
    const notch =
      (rate / Math.PI) * Math.atan(Math.tan((Math.PI * center) / rate) * Math.tan(angle));
    const dry = lateRms(render({ ...settings, mix: 0 }, notch, rate).left);
    expect(lateRms(render(settings, notch, rate).left)).toBeLessThan(dry * 0.002);
    expect(lateRms(render({ ...settings, mix: 1 }, notch, rate).left)).toBeCloseTo(dry, 4);
  }
  const peak = lateRms(render(settings, center, rate).left);
  expect(peak).toBeGreaterThan(0.06);
});

it('moves the notches, offsets the stereo sweep, and links a zero-offset mono input', () => {
  const staticSound = render({ depth: 0, feedback: 0 }, 600);
  const moving = render({ depth: 2, rate: 1, feedback: 0 }, 600);
  expect(moving.left).toEqual(moving.right);
  expect(rms(moving.left.map((x, i) => x - staticSound.left[i]!))).toBeGreaterThan(0.01);
  const wide = render({ depth: 2, rate: 1, stereo: 120 }, 600);
  expect(rms(wide.left.map((x, i) => x - wide.right[i]!))).toBeGreaterThan(0.01);
});

it('preserves more low bass and responds to signed envelope sweep and feedback', () => {
  const settings = { center: 90, depth: 0, feedback: 0, envelope: 0 };
  const cut = lateRms(render({ ...settings, bassKeep: 0 }, 35).left);
  expect(lateRms(render({ ...settings, bassKeep: 1 }, 35).left)).toBeGreaterThan(cut * 3);
  const base = render({ depth: 0, envelope: 0 }, 500).left;
  for (const envelope of [-3, 3]) {
    const changed = render({ depth: 0, envelope }, 500).left;
    expect(rms(changed.map((x, i) => x - base[i]!))).toBeGreaterThan(0.01);
  }
  const positive = render({ depth: 0, feedback: 0.8 }, 500).left;
  const negative = render({ depth: 0, feedback: -0.8 }, 500).left;
  expect(rms(positive.map((x, i) => x - negative[i]!))).toBeGreaterThan(0.01);
});

it.each([44100, 48000, 96000])(
  'stays finite through extreme edits and decays to silence at %i',
  (rate) => {
    const params = phaserParams();
    const processor = loadPhaser(rate, params);
    const input = new Float32Array(128);
    const output = [[new Float32Array(128), new Float32Array(128)]];
    let peak = 0;
    for (let block = 0; block < Math.ceil((rate * 4) / 128); block++) {
      const excite = block < (rate * 2) / 128;
      if (excite && block % 31 === 0) {
        for (const [key, bounds] of Object.entries(PHASER_BOUNDS))
          params[key]![0] = bounds[(block / 31) % 2 === 0 ? 0 : 1];
      }
      for (let i = 0; i < input.length; i++)
        input[i] = excite ? Math.sin((block * 128 + i) * 0.19) : 0;
      processor.process([[input]], output, params);
      for (const channel of output[0]!)
        for (const x of channel) {
          peak = Math.max(peak, Math.abs(x));
        }
    }
    expect(Number.isFinite(peak)).toBe(true);
    expect(peak).toBeLessThan(16);
    expect(rms(Array.from(output[0]![0]!))).toBeLessThan(0.001);
  },
);

it('fades to exact dry, keeps stereo separate and supports load/stop messages', () => {
  const params = phaserParams({ mix: 0 });
  const processor = loadPhaser(48000, params);
  const input = [new Float32Array(128).fill(0.1), new Float32Array(128).fill(-0.2)];
  const output = [[new Float32Array(128), new Float32Array(128)]];
  processor.process([input], output, params);
  expect(output[0]).toEqual(input);
  params.mix![0] = 1;
  processor.process([input], output, params);
  expect(output[0]).not.toEqual(input);
  params.enabled![0] = 0;
  for (let b = 0; b < Math.ceil((48000 * PHASER_DSP.smoothSeconds * 30) / 128); b++)
    processor.process([input], output, params);
  expect(output[0]).toEqual(input);
  processor.port.onmessage({ data: { type: 'reportLoad', quanta: 2 } });
  processor.process([input], output, params);
  processor.process([input], output, params);
  expect(processor.port.posted).toContainEqual(
    expect.objectContaining({ type: 'load', quanta: 2 }),
  );
  processor.port.onmessage({ data: { type: 'stop' } });
  expect(processor.process([input], output, params)).toBe(false);
});
