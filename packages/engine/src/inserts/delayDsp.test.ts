import { expect, it } from 'vitest';
import { delayParams, loadDelay } from '../__fixtures__/delayHarness';
import type { DelaySpec } from './delaySpec';

const RATE = 48000;
const BLOCK = 128;
type Feed = (sample: number) => readonly [number, number];
const impulse: Feed = (i) => [i === 0 ? 0.5 : 0, 0];
const silence: Feed = () => [0, 0];
function rig(spec: Partial<DelaySpec>, rate = RATE, bpm = 120) {
  const params = delayParams({ mix: 1, feedback: 0, highpass: 20, lowpass: 20000, ...spec }, bpm);
  const processor = loadDelay(rate, params);
  let clock = 0;
  return {
    params,
    processor,
    render(seconds: number, feed: Feed = silence) {
      const frames = Math.ceil((seconds * rate) / BLOCK) * BLOCK;
      const left = new Float32Array(frames),
        right = new Float32Array(frames);
      const input = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
      const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
      for (let offset = 0; offset < frames; offset += BLOCK) {
        for (let i = 0; i < BLOCK; i++) {
          const sample = feed(clock++);
          input[0]![i] = sample[0];
          input[1]![i] = sample[1];
        }
        processor.process([input], [output], params);
        left.set(output[0]!, offset);
        right.set(output[1]!, offset);
      }
      return { left, right };
    },
  };
}
const energy = (samples: Float32Array, from = 0, to = samples.length): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i]! ** 2;
  return sum;
};
const hit = (samples: Float32Array, seconds: number): number =>
  energy(samples, Math.round(seconds * RATE), Math.round(seconds * RATE) + 128);

it('times independent stereo repeats at exact synced divisions and keeps channels separate', () => {
  const spec = { leftDivision: '1/8D', rightDivision: '1/4T' } as const;
  const { left, right } = rig(spec).render(1, (i) => [i === 0 ? 0.5 : 0, i === 0 ? 0.25 : 0]);
  expect(energy(left, 0, 18000)).toBe(0);
  expect(energy(right, 0, 16000)).toBe(0);
  expect(hit(left, 0.375)).toBeGreaterThan(0.1);
  expect(hit(right, 1 / 3)).toBeGreaterThan(0.02);
  const isolated = rig(spec).render(1, impulse);
  expect(energy(isolated.right)).toBe(0);
  const slow = rig(spec, RATE, 60).render(1, impulse);
  expect(energy(slow.left, 0, 36000)).toBe(0);
  expect(hit(slow.left, 0.75)).toBeGreaterThan(0.1);
});

it('alternates mono ping-pong echoes using both time controls', () => {
  const { left, right } = rig({
    mode: 'ping-pong',
    leftSync: false,
    rightSync: false,
    leftMs: 100,
    rightMs: 200,
    feedback: 0.8,
  }).render(1, (i) => [i === 0 ? 0.5 : 0, i === 0 ? 0.5 : 0]);
  expect(hit(left, 0.1)).toBeGreaterThan(0.1);
  expect(energy(right, 0, 14400)).toBe(0);
  expect(hit(right, 0.3)).toBeGreaterThan(0.02);
  expect(hit(left, 0.4)).toBeGreaterThan(0.01);
  expect(hit(right, 0.6)).toBeGreaterThan(0.005);
  expect(hit(right, 0.1)).toBe(0);
});

it('encodes and decodes mid and side independently, preserving mono and anti-phase input', () => {
  const spec = {
    mode: 'mid-side',
    leftSync: false,
    rightSync: false,
    leftMs: 100,
    rightMs: 200,
  } as const;
  const mono = rig(spec).render(0.4, (i) => [i === 0 ? 0.5 : 0, i === 0 ? 0.5 : 0]);
  expect(mono.left).toEqual(mono.right);
  expect(hit(mono.left, 0.1)).toBeGreaterThan(0.1);
  const side = rig(spec).render(0.4, (i) => [i === 0 ? 0.5 : 0, i === 0 ? -0.5 : 0]);
  expect(energy(side.left, 0, 9600)).toBe(0);
  expect(hit(side.left, 0.2)).toBeGreaterThan(0.1);
  for (let i = 0; i < side.left.length; i++) expect(side.left[i]! + side.right[i]!).toBe(0);
});

it('filters the first repeat and progressively colors regeneration', () => {
  const spec = { leftSync: false, leftMs: 100, feedback: 0.85 };
  const open = rig(spec).render(0.5, impulse);
  const dark = rig({ ...spec, lowpass: 600 }).render(0.5, impulse);
  expect(hit(dark.left, 0.1)).toBeLessThan(hit(open.left, 0.1) / 10);
  expect(hit(dark.left, 0.3) / hit(dark.left, 0.1)).toBeLessThan(
    hit(open.left, 0.3) / hit(open.left, 0.1),
  );
  const bass: Feed = (i) => [Math.sin((2 * Math.PI * 80 * i) / RATE) * 0.2, 0];
  const low = rig({ ...spec, feedback: 0, highpass: 20 }).render(0.5, bass);
  const cut = rig({ ...spec, feedback: 0, highpass: 1500 }).render(0.5, bass);
  expect(energy(cut.left)).toBeLessThan(energy(low.left) / 100);
});

it('keeps dry stereo exact at zero mix and bypass, and applies output gain after mixing', () => {
  const feed: Feed = (i) => [Math.sin(i) * 0.2, Math.cos(i) * 0.1];
  for (const spec of [{ mix: 0 }, { enabled: false, outputDb: 12 }]) {
    const rendered = rig(spec).render(0.1, feed);
    for (let i = 0; i < rendered.left.length; i++) {
      expect(rendered.left[i]).toBe(Math.fround(feed(i)[0]));
      expect(rendered.right[i]).toBe(Math.fround(feed(i)[1]));
    }
  }
  const gain = rig({ mix: 0, outputDb: 6 }).render(0.1, feed);
  expect(gain.left[1]).toBeCloseTo(feed(1)[0] * 10 ** (6 / 20), 6);
});

it.each([44100, 48000, 96000])(
  'keeps long regeneration finite through extreme live changes at %i Hz',
  (rate) => {
    const r = rig(
      { feedback: 1.2, drive: 12, leftSync: false, rightSync: false, leftMs: 20, rightMs: 37 },
      rate,
    );
    const seed: Feed = (i) => [
      i < rate / 10 ? Math.sin(i * 0.13) * 0.7 : 0,
      i < rate / 10 ? Math.cos(i * 0.09) * 0.7 : 0,
    ];
    r.render(1, seed);
    r.params.leftMs![0] = 1000;
    r.params.mode![0] = 2;
    r.params.lowpass![0] = 200;
    r.params.highpass![0] = 4000;
    r.params.drive![0] = 24;
    r.params.outputDb![0] = 12;
    const out = r.render(3);
    let peak = 0;
    for (const channel of [out.left, out.right])
      for (const value of channel) peak = Math.max(peak, Math.abs(value));
    expect(Number.isFinite(peak)).toBe(true);
    expect(peak).toBeLessThan(32);
    r.params.enabled![0] = 0;
    const bypass = r.render(2);
    expect(energy(bypass.left, bypass.left.length - 128)).toBeLessThan(1e-20);
  },
);

it('supports long delay storage and a sustained dub tail, then lets feedback decay', () => {
  const long = rig({ leftDivision: '1/1' }, RATE, 20).render(12.1, impulse);
  expect(energy(long.left, 0, RATE * 12)).toBe(0);
  expect(hit(long.left, 12)).toBeGreaterThan(0.1);
  const r = rig({ leftSync: false, leftMs: 100, feedback: 1.1 });
  r.render(1, (i) => [i < 100 ? Math.sin(i * 0.2) * 0.4 : 0, 0]);
  expect(energy(r.render(6).left)).toBeGreaterThan(1);
  r.params.feedback![0] = 0;
  const tail = r.render(2);
  expect(energy(tail.left, tail.left.length - 128)).toBeLessThan(1e-20);
});

it('reports load and stops processing when disposed', () => {
  const r = rig({});
  r.processor.port.onmessage({ data: { type: 'reportLoad', quanta: 1 } });
  r.render(0.01);
  expect(r.processor.port.posted).toContainEqual(
    expect.objectContaining({ type: 'load', quanta: 1 }),
  );
  r.processor.port.onmessage({ data: { type: 'stop' } });
  expect(r.processor.process([], [[new Float32Array(BLOCK)]], r.params)).toBe(false);
});
