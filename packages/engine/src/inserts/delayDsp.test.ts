/**
 * The Dub delay on its shipped bundle (record `2026-10-17-dub-delay-regeneration`):
 * timing and routing, the loop's filter and tone on every repeat, Cross,
 * Sustain, the governor's loudness-neutral Drive and its held runaway, the
 * dry path's bits, and the switch.
 */
import { describe, expect, it } from 'vitest';
import { delayParams, loadDelay } from '../__fixtures__/delayHarness';
import { DELAY_GOVERNOR } from './delayConstants';
import type { DelaySpec } from './delaySpec';

const RATE = 48000;
const BLOCK = 128;
type Feed = (sample: number) => readonly [number, number];
const impulse: Feed = (i) => [i === 0 ? 0.5 : 0, 0];
const silence: Feed = () => [0, 0];
/** A clean, flat loop: no Cross, no tone, no motion, Drive at 0, the wet path alone. */
const FLAT: Partial<DelaySpec> = {
  mix: 1,
  feedback: 0,
  cross: 0,
  lowCut: 20,
  filter: 'lowpass',
  cutoff: 16000,
  resonance: 0,
  drive: 0,
  damping: 0,
  wow: 0,
  sweep: 0,
};
function rig(spec: Partial<DelaySpec>, rate = RATE, bpm = 120) {
  const params = delayParams({ ...FLAT, ...spec }, bpm);
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
const rms = (samples: Float32Array, from: number, to: number): number =>
  Math.sqrt(energy(samples, from, to) / (to - from));
const hit = (samples: Float32Array, seconds: number, rate = RATE): number =>
  energy(samples, Math.round(seconds * rate), Math.round(seconds * rate) + 128);
const noiseBurst =
  (seconds: number, rate = RATE, level = 0.5): Feed =>
  (i) => {
    if (i >= seconds * rate) return [0, 0];
    const x = Math.sin(i * 12.9898) * 43758.5453;
    const y = Math.sin(i * 78.233) * 12345.678;
    return [(x - Math.floor(x) - 0.5) * 2 * level, (y - Math.floor(y) - 0.5) * 2 * level];
  };

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

it('alternates mono ping-pong echoes at Cross 1, each waiting for its own side', () => {
  const { left, right } = rig({
    mode: 'ping-pong',
    leftSync: false,
    rightSync: false,
    leftMs: 100,
    rightMs: 200,
    feedback: 0.8,
    cross: 1,
  }).render(1, (i) => [i === 0 ? 0.5 : 0, i === 0 ? 0.5 : 0]);
  expect(hit(left, 0.1)).toBeGreaterThan(0.1);
  expect(energy(right, 0, 14400)).toBe(0);
  expect(hit(right, 0.3)).toBeGreaterThan(0.02);
  expect(hit(left, 0.4)).toBeGreaterThan(0.005);
  expect(hit(right, 0.1)).toBe(0);
});

it('keeps each line to itself at Cross 0 and shares its feedback at Cross 0.5', () => {
  const spec = { leftSync: false, rightSync: false, leftMs: 100, rightMs: 150, feedback: 0.8 };
  const apart = rig({ ...spec, cross: 0 }).render(1, impulse);
  expect(energy(apart.right)).toBe(0);
  const shared = rig({ ...spec, cross: 0.5 }).render(1, impulse);
  expect(hit(shared.right, 0.25)).toBeGreaterThan(0.005);
  expect(hit(shared.left, 0.2)).toBeGreaterThan(0.005);
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

it('filters the first repeat and darkens each one after it, through the filter and the damping', () => {
  const spec = { leftSync: false, leftMs: 100, feedback: 0.85 };
  const open = rig(spec).render(0.5, impulse);
  for (const tone of [{ cutoff: 600 }, { damping: 24, dampingHz: 600 }]) {
    const dark = rig({ ...spec, ...tone }).render(0.5, impulse);
    expect(hit(dark.left, 0.1)).toBeLessThan(hit(open.left, 0.1) / 4);
    expect(hit(dark.left, 0.3) / hit(dark.left, 0.1)).toBeLessThan(
      hit(open.left, 0.3) / hit(open.left, 0.1),
    );
  }
  const bass: Feed = (i) => [Math.sin((2 * Math.PI * 80 * i) / RATE) * 0.2, 0];
  const low = rig({ ...spec, feedback: 0 }).render(0.5, bass);
  const cut = rig({ ...spec, feedback: 0, lowCut: 1000 }).render(0.5, bass);
  expect(energy(cut.left)).toBeLessThan(energy(low.left) / 100);
});

it('keeps Drive loudness neutral: more harmonics, not more level', () => {
  const tone: Feed = (i) => [Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.3, 0];
  const at = (drive: number, character: DelaySpec['character']) => {
    const { left } = rig({ leftSync: false, leftMs: 10, drive, character }).render(1, tone);
    return rms(left, RATE / 2, RATE);
  };
  const clean = at(0, 'warm');
  for (const character of ['warm', 'fold'] as const) {
    const driven = at(30, character);
    expect(Math.abs(20 * Math.log10(driven / clean))).toBeLessThan(1);
  }
});

it.each([44100, 48000, 96000])(
  'holds a resonant runaway at the governor ceiling, steady and finite, at %i Hz',
  (rate) => {
    const r = rig(
      {
        leftSync: false,
        rightSync: false,
        leftMs: 180,
        rightMs: 240,
        feedback: 1,
        filter: 'peak',
        cutoff: 400,
        resonance: 18,
        width: 0.6,
        drive: 12,
      },
      rate,
    );
    const first = r.render(4, noiseBurst(0.05, rate));
    const later = r.render(4);
    for (const channel of [first.left, later.left]) {
      for (const value of channel) expect(Number.isFinite(value)).toBe(true);
    }
    const settled = rms(first.left, 3 * rate, 4 * rate);
    const held = rms(later.left, 3 * rate, 4 * rate);
    expect(settled).toBeGreaterThan(DELAY_GOVERNOR.ceiling / 2);
    expect(settled).toBeLessThan(DELAY_GOVERNOR.ceiling * 1.5);
    expect(Math.abs(20 * Math.log10(held / settled))).toBeLessThan(1.5);
  },
  30_000,
);

it('sustains the loop with no new input, and lets it decay once released', () => {
  const r = rig({ leftSync: false, leftMs: 100, feedback: 0.6 });
  r.render(0.2, (i) => [i < 200 ? Math.sin(i * 0.2) * 0.4 : 0, 0]);
  r.params.sustain![0] = 1;
  const held = r.render(4, noiseBurst(4));
  // The noise reaches the dry path only, and the wet path alone is heard: the loop
  // still holds what it had at Sustain's press.
  expect(rms(held.left, 3 * RATE, 4 * RATE)).toBeGreaterThan(0.01);
  r.params.sustain![0] = 0;
  r.params.feedback![0] = 0;
  const tail = r.render(2);
  expect(energy(tail.left, tail.left.length - 128)).toBeLessThan(1e-20);

  const frozen = rig({ leftSync: false, leftMs: 100, feedback: 0.6, sustain: true });
  expect(energy(frozen.render(1, noiseBurst(1)).left)).toBe(0);
});

it('supports long delay storage at a slow tempo', () => {
  const long = rig({ leftDivision: '1/1' }, RATE, 20).render(12.1, impulse);
  expect(energy(long.left, 0, RATE * 12)).toBe(0);
  expect(hit(long.left, 12)).toBeGreaterThan(0.1);
});

describe('through extreme live changes', () => {
  it.each([44100, 48000, 96000])('stays finite and bounded at %i Hz', (rate) => {
    const r = rig(
      { feedback: 1, drive: 24, leftSync: false, rightSync: false, leftMs: 20, rightMs: 37 },
      rate,
    );
    r.render(1, noiseBurst(0.1, rate, 0.7));
    const p = r.params;
    p.leftMs![0] = 1000;
    p.mode![0] = 2;
    p.filter![0] = 2;
    p.resonance![0] = 20;
    p.cutoff![0] = 90;
    p.character![0] = 1;
    p.sustain![0] = 1;
    p.wow![0] = 1;
    p.sweep![0] = 4;
    p.modRate![0] = 10;
    p.wave![0] = 2;
    p.outputDb![0] = 12;
    const out = r.render(3);
    let peak = 0;
    for (const channel of [out.left, out.right])
      for (const value of channel) peak = Math.max(peak, Math.abs(value));
    expect(Number.isFinite(peak)).toBe(true);
    expect(peak).toBeLessThan(32);
    p.enabled![0] = 0;
    const bypass = r.render(2);
    expect(energy(bypass.left, bypass.left.length - 128)).toBeLessThan(1e-20);
  });
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
