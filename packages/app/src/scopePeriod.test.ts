import { describe, expect, it } from 'vitest';
import { createPeriodDetector, risingCrossing } from './scopePeriod';

const RATE = 48000;
const LENGTH = 8192;
const TAU = 2 * Math.PI;

const signal = (at: (t: number) => number): Float32Array => {
  const x = new Float32Array(LENGTH);
  for (let i = 0; i < LENGTH; i++) x[i] = at(i / RATE);
  return x;
};
const sine = (hz: number, amp = 0.5): Float32Array => signal((t) => amp * Math.sin(TAU * hz * t));
/** A band-limited sawtooth: every harmonic below Nyquist at 1/k. */
const saw = (hz: number): Float32Array =>
  signal((t) => {
    let v = 0;
    for (let k = 1; k * hz < RATE / 2; k++) v += Math.sin(TAU * k * hz * t) / k;
    return 0.3 * v;
  });
/** A bright FM tone: a carrier at `hz` modulated at `ratio × hz` with index `index`. */
const fm = (hz: number, ratio: number, index: number): Float32Array =>
  signal((t) => 0.5 * Math.sin(TAU * hz * t + index * Math.sin(TAU * ratio * hz * t)));
const chord = (...hz: number[]): Float32Array =>
  signal((t) => hz.reduce((v, f) => v + (0.5 / hz.length) * Math.sin(TAU * f * t), 0));
const midiHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** A seeded white noise, so the test is the same on every run. */
const noise = (amp: number): Float32Array => {
  let seed = 12345;
  return signal(() => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return amp * (seed / 1073741824 - 1);
  });
};

const detect = (x: Float32Array): number =>
  createPeriodDetector({ sampleRate: RATE, length: LENGTH }).detect(x);
/** The period found in `x` reads as `hz` to 0.1%: under a pixel's drift across two periods. */
const expectHz = (x: Float32Array, hz: number): void => {
  expect(Math.abs(RATE / detect(x) / hz - 1)).toBeLessThan(0.001);
};

describe('createPeriodDetector', () => {
  it.each([
    ['C1', midiHz(24)],
    ['A1', midiHz(33)],
    ['A4', 440],
    ['C7', midiHz(96)],
    ['the top of the range', 3900],
  ])('finds a sine at %s', (_name, hz) => {
    expectHz(sine(hz), hz);
  });

  it('finds a quiet sine as well as a loud one', () => {
    expectHz(sine(110, 0.01), 110);
  });

  it.each([midiHz(24), 110, midiHz(84)])(
    'finds a sawtooth at %f Hz, not one of its harmonics',
    (hz) => {
      expectHz(saw(hz), hz);
    },
  );

  it.each([
    [110, 1, 5],
    [220, 2, 3],
    [midiHz(84), 1, 4],
  ])('finds an FM tone at %f Hz (ratio %f, index %f)', (hz, ratio, index) => {
    expectHz(fm(hz, ratio, index), hz);
  });

  it('finds the same period frame after frame', () => {
    const hz = midiHz(45);
    const tone = (shift: number): Float32Array =>
      signal((t) => {
        const at = t + shift / RATE;
        return 0.5 * Math.sin(TAU * hz * at + 3 * Math.sin(TAU * 3 * hz * at));
      });
    const periods = [0, 333, 1001, 2500].map((shift) => detect(tone(shift)));
    for (const p of periods) expect(p).toBeCloseTo(periods[0]!, 1);
  });

  it('finds no period in silence', () => {
    expect(detect(new Float32Array(LENGTH))).toBe(0);
  });

  it('finds no period in white noise', () => {
    expect(detect(noise(0.5))).toBe(0);
  });

  it('finds no period in a dense chord', () => {
    expect(detect(chord(...[60, 62, 64, 65, 67, 71].map(midiHz)))).toBe(0);
  });

  it('finds no period below its range', () => {
    expect(detect(sine(15))).toBe(0);
  });

  it('finds no period just below its range', () => {
    expect(detect(sine(29.5))).toBe(0);
  });

  it('finds no period above its range, not a multiple of it', () => {
    expect(detect(sine(5000))).toBe(0);
  });

  it('finds no period just above its range', () => {
    expect(detect(sine(4100))).toBe(0);
  });
});

describe('risingCrossing', () => {
  it('finds the interpolated crossing with the steepest rise', () => {
    const x = Float32Array.from([-1, 0.1, -0.1, -0.5, 0.5, 1, -1, 0.2]);
    // Rising crossings at 0→1 (rise 1.1), 3→4 (rise 1) and 6→7 (rise 1.2), the last steepest.
    expect(risingCrossing(x, 0, 7)).toBeCloseTo(6 + 1 / 1.2, 5);
    expect(risingCrossing(x, 0, 5)).toBeCloseTo(1 / 1.1, 5);
  });

  it('returns its start when there is no rising crossing', () => {
    expect(risingCrossing(Float32Array.from([0.5, 0.4, 0.3]), 1, 3)).toBe(1);
  });
});
