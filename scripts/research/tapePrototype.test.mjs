/** Research tests live here so the normal verify gate discovers them. */
import { describe, it, expect } from 'vitest';
import { Hysteresis } from '../../docs/research/2026-09-30-tape-phase-3/hysteresis.ts';
import { ResampledHysteresis } from '../../docs/research/2026-09-30-tape-phase-3/resampler.ts';
import {
  powerSpectrum,
  spectrumMetrics,
  errorDb,
} from '../../docs/research/2026-09-30-tape-phase-3/spectra.mjs';

describe('Tape research: magnetic state', () => {
  it.each(['rk2', 'rk4'])('remembers opposite histories at identical zero input (%s)', (solver) => {
    const positive = new Hysteresis(192000, solver),
      negative = new Hysteresis(192000, solver);
    for (let i = 0; i < 4096; i++) {
      const x = Math.sin((Math.PI * i) / 4096);
      positive.tick(x);
      negative.tick(-x);
    }
    for (let i = 0; i < 4096; i++) {
      positive.tick(0);
      negative.tick(0);
    }
    expect(Math.abs(positive.m)).toBeGreaterThan(0.01);
    expect(positive.m).toBeCloseTo(-negative.m, 10);
    expect(positive.resets + negative.resets).toBe(0);
  });
  it('handles zero and tiny inputs without a singular coth calculation', () => {
    const dsp = new Hysteresis(48000);
    for (let i = 0; i < 1024; i++) expect(dsp.tick(0)).toBe(0);
    for (let i = 0; i < 1024; i++)
      expect(Number.isFinite(dsp.tick(1e-14 * Math.sin(i)))).toBe(true);
    expect(dsp.resets).toBe(0);
  });
  it('guards both polarities and exposes recovery rather than silently counting it as stability', () => {
    const dsp = new Hysteresis(48000);
    for (const m of [-1e100, 1e100]) {
      dsp.m = m;
      expect(dsp.tick(0)).toBe(0);
    }
    expect(dsp.resets).toBe(2);
    for (const x of [NaN, Infinity, -Infinity]) expect(dsp.tick(x)).toBe(0);
    expect(dsp.resets).toBe(5);
    expect(dsp.tick(0)).toBe(0);
    dsp.tick(100);
    dsp.tick(-100);
    expect(dsp.clips).toBe(2);
  });
  it('is deterministic through control edits and reset', () => {
    const a = new Hysteresis(96000),
      b = new Hysteresis(96000);
    for (let i = 0; i < 4096; i++) {
      if (i % 128 === 127) {
        a.configure(0.8, 0.2, 0.9);
        b.configure(0.8, 0.2, 0.9);
      }
      expect(a.tick(Math.sin(i / 50))).toBe(b.tick(Math.sin(i / 50)));
    }
    a.reset();
    b.reset();
    expect(a.tick(0.001)).toBe(b.tick(0.001));
  });
});
describe('Tape research: resampling and measurement', () => {
  it('converges under refinement without resetting at a coherent midband tone', () => {
    const render = (factor) => {
      const dsp = new ResampledHysteresis({ rate: 48000, factor, solver: 'rk4' });
      const output = new Float64Array(4096);
      for (let i = 0; i < 8192; i++) {
        const y = dsp.tick(0.25 * Math.sin((2 * Math.PI * 87 * i) / 4096));
        if (i >= 4096) output[i - 4096] = y;
      }
      expect(dsp.core.resets).toBe(0);
      return output;
    };
    const reference = render(32);
    const errors = [2, 4, 8].map((factor) => errorDb(render(factor), reference));
    expect(errors[1]).toBeLessThan(errors[0] - 3);
    expect(errors[2]).toBeLessThan(errors[1] - 3);
    expect(errors[1]).toBeLessThan(-48);
  });
  it.each([2, 4, 8, 32])('measures 32 samples FIR latency and unity DC at %ix', (factor) => {
    const dsp = new ResampledHysteresis({ rate: 48000, factor, identity: true });
    const impulse = Float64Array.from({ length: 128 }, (_, i) => dsp.tick(i === 0 ? 1 : 0));
    expect(impulse.indexOf(Math.max(...impulse))).toBe(32);
    expect(impulse.reduce((a, b) => a + b)).toBeCloseTo(1, 5);
    let y = 0;
    for (let i = 0; i < 256; i++) y = dsp.tick(1);
    expect(y).toBeCloseTo(1, 5);
  });
  it('keeps independent channel state and accepts first/last block samples', () => {
    const left = new ResampledHysteresis({ rate: 44100, factor: 4 });
    const right = new ResampledHysteresis({ rate: 44100, factor: 4 });
    for (let i = 0; i < 512; i++) {
      expect(Number.isFinite(left.tick(i % 128 === 0 || i % 128 === 127 ? 1 : 0))).toBe(true);
      expect(right.tick(0)).toBe(0);
    }
  });
  it('separates intended harmonics from a known folded alias and preserves FFT power', () => {
    const n = 1024,
      bin = 173;
    const samples = Float64Array.from({ length: n }, (_, i) =>
      Math.sin((2 * Math.PI * bin * i) / n),
    );
    const clean = spectrumMetrics(samples, bin);
    expect(clean.nonHarmonicDbc).toBeLessThan(-200);
    expect(powerSpectrum(samples).reduce((a, b) => a + b)).toBeCloseTo(0.5, 12);
    const distorted = Float64Array.from(samples, (x) => x ** 3);
    // Third harmonic is 519/1024, above Nyquist: folds to bin 505.
    expect(spectrumMetrics(distorted, bin).nonHarmonicDbc).toBeCloseTo(10 * Math.log10(1 / 9), 8);
  });
});
