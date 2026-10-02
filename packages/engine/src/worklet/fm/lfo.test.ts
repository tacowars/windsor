import { describe, expect, it } from 'vitest';

import type { LfoSettings } from '../../patch/patch';
import {
  LFO_DRIFT,
  LFO_SAW_DOWN,
  LFO_SAW_UP,
  LFO_SH,
  LFO_SINE,
  LFO_SQUARE,
  LFO_TRI,
} from './modeIds';
import { makeRandom, randomSeed32 } from './prng';

// `waveTables` warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { Lfo, secondLfoSeed } = await import('./lfo');

const SR = 48000;
const settings = (o: Partial<LfoSettings> = {}): LfoSettings => ({
  shape: LFO_SINE,
  rate: 1,
  amount: 1,
  delay: 0,
  retrigger: true,
  oneShot: false,
  unipolar: false,
  toPitch: 0,
  modWheelDepth: 1,
  toOp: [0, 0, 0, 0],
  toWidth: [0, 0, 0, 0],
  ...o,
});

type LfoInstance = InstanceType<typeof Lfo>;

/**
 * Advance `lfo` at `p`'s rate by `n` samples and read its value, which
 * `advance` leaves in `output` (windsor#233); the voice writes the rate the
 * same way each control block (windsor#419).
 */
function advanced(lfo: LfoInstance, p: LfoSettings, n: number, rate: number): number {
  lfo.rate = p.rate;
  lfo.advance(p, n, rate);
  return lfo.output;
}

describe('the LFO', () => {
  it('runs a square at +1 for the first half cycle and -1 for the second', () => {
    const lfo = new Lfo(randomSeed32(makeRandom(1)));
    lfo.reset(true);
    const p = settings({ shape: LFO_SQUARE });
    expect(advanced(lfo, p, SR / 4, SR)).toBe(1);
    expect(advanced(lfo, p, SR / 2, SR)).toBe(-1);
  });

  it('reads the sine from the operators’ table', () => {
    const lfo = new Lfo(randomSeed32(makeRandom(1)));
    lfo.reset(true);
    expect(advanced(lfo, settings(), SR / 4, SR)).toBeCloseTo(1, 6);
  });

  it('holds a sample until the phase wraps, and repeats for a seed', () => {
    const a = new Lfo(randomSeed32(makeRandom(3)));
    const b = new Lfo(randomSeed32(makeRandom(3)));
    a.reset(true);
    b.reset(true);
    const p = settings({ shape: LFO_SH });
    const first = advanced(a, p, 100, SR);
    expect(advanced(a, p, 100, SR)).toBe(first);
    expect(advanced(b, p, 100, SR)).toBe(first);
    expect(advanced(a, p, SR, SR)).not.toBe(first);
  });

  it('fades in over the delay', () => {
    const lfo = new Lfo(randomSeed32(makeRandom(1)));
    lfo.reset(true);
    expect(advanced(lfo, settings({ shape: LFO_SQUARE, delay: 1 }), SR / 4, SR)).toBe(0.25);
  });

  it('runs a one-shot once and holds its end value (#55)', () => {
    const lfo = new Lfo(randomSeed32(makeRandom(1)));
    lfo.reset(true);
    const p = settings({ shape: LFO_SAW_DOWN, oneShot: true });
    expect(advanced(lfo, p, SR / 2, SR)).toBe(0);
    expect(advanced(lfo, p, SR, SR)).toBe(-1);
    expect(advanced(lfo, p, SR * 10, SR)).toBe(-1);
    lfo.reset(true);
    expect(advanced(lfo, p, SR / 4, SR)).toBe(0.5);
  });

  it('holds one sample-and-hold value for a whole one-shot', () => {
    const lfo = new Lfo(randomSeed32(makeRandom(5)));
    lfo.reset(true);
    const p = settings({ shape: LFO_SH, rate: 20, oneShot: true });
    const first = advanced(lfo, p, 100, SR);
    for (let i = 0; i < 50; i++) expect(advanced(lfo, p, SR / 7, SR)).toBe(first);
  });

  it('maps every shape to 0..1 when unipolar, before the fade', () => {
    for (const shape of [
      LFO_SINE,
      LFO_TRI,
      LFO_SAW_UP,
      LFO_SAW_DOWN,
      LFO_SQUARE,
      LFO_SH,
      LFO_DRIFT,
    ]) {
      const lfo = new Lfo(randomSeed32(makeRandom(shape + 1)));
      lfo.reset(true);
      const p = settings({ shape, rate: 13, unipolar: true });
      for (let i = 0; i < 400; i++) {
        const v = advanced(lfo, p, 97, SR);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    const square = new Lfo(randomSeed32(makeRandom(1)));
    square.reset(true);
    const p = settings({ shape: LFO_SQUARE, unipolar: true });
    expect(advanced(square, p, SR / 4, SR)).toBe(1);
    expect(advanced(square, p, SR / 2, SR)).toBe(0);
    // The fade scales the 0..1 value up from 0.
    square.reset(true);
    expect(
      advanced(square, settings({ shape: LFO_SQUARE, unipolar: true, delay: 1 }), SR / 4, SR),
    ).toBe(0.25);
  });

  it('seeds a second LFO from the first without a draw: non-zero, distinct, repeatable', () => {
    for (const seed of [1, 2, 0x9e3779b9, 0xffffffff, randomSeed32(makeRandom(9))]) {
      const derived = secondLfoSeed(seed);
      expect(derived).toBeGreaterThan(0);
      expect(derived).toBeLessThanOrEqual(0xffffffff);
      expect(derived).not.toBe(seed);
      expect(secondLfoSeed(seed)).toBe(derived);
    }
  });
});
