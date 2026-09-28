import { describe, expect, it } from 'vitest';

import type { LfoSettings } from '../../patch/patch';
import { LFO_SH, LFO_SINE, LFO_SQUARE } from './modeIds';
import { makeRandom } from './prng';

// `waveTables` warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { Lfo } = await import('./lfo');

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

describe('the LFO', () => {
  it('runs a square at +1 for the first half cycle and -1 for the second', () => {
    const lfo = new Lfo(makeRandom(1));
    lfo.reset(true);
    const p = settings({ shape: LFO_SQUARE });
    expect(lfo.advance(p, SR / 4, SR)).toBe(1);
    expect(lfo.advance(p, SR / 2, SR)).toBe(-1);
  });

  it('reads the sine from the operators’ table', () => {
    const lfo = new Lfo(makeRandom(1));
    lfo.reset(true);
    expect(lfo.advance(settings(), SR / 4, SR)).toBeCloseTo(1, 6);
  });

  it('holds a sample until the phase wraps, and repeats for a seed', () => {
    const a = new Lfo(makeRandom(3));
    const b = new Lfo(makeRandom(3));
    a.reset(true);
    b.reset(true);
    const p = settings({ shape: LFO_SH });
    const first = a.advance(p, 100, SR);
    expect(a.advance(p, 100, SR)).toBe(first);
    expect(b.advance(p, 100, SR)).toBe(first);
    expect(a.advance(p, SR, SR)).not.toBe(first);
  });

  it('fades in over the delay', () => {
    const lfo = new Lfo(makeRandom(1));
    lfo.reset(true);
    expect(lfo.advance(settings({ shape: LFO_SQUARE, delay: 1 }), SR / 4, SR)).toBe(0.25);
  });
});
