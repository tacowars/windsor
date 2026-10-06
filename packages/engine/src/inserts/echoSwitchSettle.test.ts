/**
 * How long the Echo's loop holds the repeats from before an off (fix round 1
 * for PR #635): one delay time, the longest the line reaches until it has
 * passed; then the damp filter's ring to -90 dB (fix round 2), the longest
 * Damp and Resonance give over that time. Fix round 3 reads the ring off the
 * filter's digital poles, which ring long near Nyquist too.
 */
import { describe, expect, it } from 'vitest';

import { loopEmptiesIn, loopSettlesIn, ringTime } from './echoSwitchSettle';
import { FieldTimeline } from './fieldTimeline';

const RATE = 48000;

describe('loopEmptiesIn', () => {
  it('is the knob’s delay time with no lane', () => {
    expect(loopEmptiesIn(2, new FieldTimeline(() => 0.28))).toBe(0.28);
  });

  it('grows to the longest delay a lane reaches before it has passed, and no further', () => {
    const delay = new FieldTimeline(() => 0.28);
    delay.schedule(0.28, 2, 'set');
    delay.schedule(0.5, 2.2, 'ramp');
    // Past 2 + 0.5: never reached.
    delay.schedule(4, 3, 'set');
    expect(loopEmptiesIn(2, delay)).toBe(0.5);
  });
});

/**
 * The RBJ lowpass's free ring, run as Web Audio's `BiquadFilterNode` runs it
 * (`__fixtures__/fakeAudioNodes.ts`): its loudest over `window` samples from
 * `from`, in dB against its loudest over the first `window`.
 */
function ringFallDb(cutoff: number, resonance: number, from: number, window: number): number {
  const w0 = (2 * Math.PI * cutoff) / RATE;
  const alpha = Math.sin(w0) / (2 * Math.pow(10, resonance / 20));
  const a1 = (-2 * Math.cos(w0)) / (1 + alpha);
  const a2 = (1 - alpha) / (1 + alpha);
  let y1 = 1;
  let y2 = 0;
  let first = 1;
  let later = 0;
  for (let n = 1; n < from + window; n++) {
    const y = -a1 * y1 - a2 * y2;
    if (n < window) first = Math.max(first, Math.abs(y));
    if (n >= from) later = Math.max(later, Math.abs(y));
    y2 = y1;
    y1 = y;
  }
  return 20 * Math.log10(later / first);
}

describe('ringTime', () => {
  it('is about a millisecond at the defaults, and over a second at the lowest Damp', () => {
    expect(ringTime(3200, 1, RATE)).toBeCloseTo(0.001178, 5);
    expect(ringTime(10, 12, RATE)).toBeCloseTo(1.313, 3);
  });

  it('rings longer near Nyquist than a continuous filter would (fix round 3)', () => {
    // The continuous estimate gave 0.657 ms here.
    expect(ringTime(20000, 12, RATE)).toBeCloseTo(0.00343, 5);
    expect(ringTime(20000, 12, RATE)).toBeGreaterThan(ringTime(12000, 12, RATE));
  });

  it('holds nothing at Nyquist, where the node passes its input through', () => {
    expect(ringTime(RATE / 2, 12, RATE)).toBe(0);
  });

  it.each([
    [3200, 1],
    [20000, 12],
    [100, 12],
  ])('matches the RBJ pole envelope at %d Hz, %d dB: 90 dB down by then', (cutoff, resonance) => {
    const samples = Math.round(ringTime(cutoff, resonance, RATE) * RATE);
    const fall = ringFallDb(cutoff, resonance, samples, 2 * Math.ceil(RATE / cutoff));
    expect(fall).toBeLessThan(-87);
    expect(fall).toBeGreaterThan(-93);
  });
});

describe('loopSettlesIn', () => {
  const knob = (value: number) => new FieldTimeline(() => value);

  it('is the delay time, then the damp filter’s ring', () => {
    const line = { delayTime: knob(0.02), damp: knob(10), resonance: knob(12), sampleRate: RATE };
    expect(loopSettlesIn(2, line)).toBeCloseTo(0.02 + ringTime(10, 12, RATE), 12);
  });

  it('rings as long as the lowest Damp a lane reaches before it has rung out, and no later', () => {
    const line = (dropAt: number) => {
      const damp = new FieldTimeline(() => 3200);
      damp.schedule(3200, 2.2, 'set');
      damp.schedule(10, dropAt, 'set');
      return { delayTime: knob(0.28), damp, resonance: knob(12), sampleRate: RATE };
    };
    // At 3200 Hz the ring is 4 ms: over by 2.285.
    expect(loopSettlesIn(2, line(2.282))).toBeCloseTo(0.28 + ringTime(10, 12, RATE), 12);
    expect(loopSettlesIn(2, line(2.3))).toBeCloseTo(0.28 + ringTime(3200, 12, RATE), 12);
  });

  it('rings as long as the highest Damp a lane reaches, near Nyquist', () => {
    // A quarter of the rate rings shortest; up from there, longer.
    const damp = new FieldTimeline(() => 12000);
    damp.schedule(12000, 2.2, 'set');
    damp.schedule(20000, 2.25, 'ramp');
    const line = { delayTime: knob(0.28), damp, resonance: knob(12), sampleRate: RATE };
    expect(loopSettlesIn(2, line)).toBeCloseTo(0.28 + ringTime(20000, 12, RATE), 12);
  });
});
