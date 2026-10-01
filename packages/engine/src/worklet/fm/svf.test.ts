import { describe, expect, it } from 'vitest';

import { FILT_HP, FILT_LP } from './modeIds';
import { Svf } from './svf';

const SR = 48000;

/** Set a filter's cutoff and Q, the fields `setCoeffs` reads (windsor#233), and its coefficients. */
function tune(svf: Svf, cutoffHz: number, q: number): void {
  svf.cutoffHz = cutoffHz;
  svf.q = q;
  svf.setCoeffs(SR);
}

describe('the state-variable filter', () => {
  it('passes DC through the lowpass and blocks it in the highpass', () => {
    const lp = new Svf();
    const hp = new Svf();
    tune(lp, 1000, 0.707);
    tune(hp, 1000, 0.707);
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
    tune(svf, 1000, 0.707);
    expect(Svf.quiet(svf)).toBe(true);
    svf.process(1, FILT_LP);
    expect(Svf.quiet(svf)).toBe(false);
    svf.reset();
    expect(Svf.quiet(svf)).toBe(true);
  });
});
