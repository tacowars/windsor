import { describe, expect, it } from 'vitest';

import { FILT_HP, FILT_LP } from './modeIds';
import { softClip, Svf } from './svf';

const SR = 48000;

describe('the state-variable filter', () => {
  it('passes DC through the lowpass and blocks it in the highpass', () => {
    const lp = new Svf();
    const hp = new Svf();
    lp.setCoeffs(1000, 0.707, SR);
    hp.setCoeffs(1000, 0.707, SR);
    let l = 0;
    let h = 0;
    for (let i = 0; i < 4000; i++) {
      l = lp.process(1, FILT_LP);
      h = hp.process(1, FILT_HP);
    }
    expect(l).toBeCloseTo(1, 4);
    expect(h).toBeCloseTo(0, 4);
  });

  it('is quiet when fresh, ringing after input, and quiet again after reset', () => {
    const svf = new Svf();
    svf.setCoeffs(1000, 0.707, SR);
    expect(Svf.quiet(svf)).toBe(true);
    svf.process(1, FILT_LP);
    expect(Svf.quiet(svf)).toBe(false);
    svf.reset();
    expect(Svf.quiet(svf)).toBe(true);
  });

  it('soft clips: odd, bounded at ±1, identity near zero', () => {
    expect(softClip(0.001)).toBeCloseTo(0.001, 6);
    expect(softClip(-0.7)).toBe(-softClip(0.7));
    expect(softClip(10)).toBe(1);
    expect(softClip(-10)).toBe(-1);
    expect(Math.abs(softClip(2.9))).toBeLessThanOrEqual(1);
  });
});
