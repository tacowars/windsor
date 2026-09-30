import { describe, expect, it } from 'vitest';
import { EQ_SPECTRUM } from '@windsor/engine';
import { eqPlot, freqOfX } from './eqCurveModel';
import type { SpectrumFrame } from './eqSpectrum';
import { createSpectrumGate, spectrumLevels } from './eqSpectrum';
import { EQ_SPECTRUM_VIEW as V } from './eqTables';

/** A card on screen with the transport running, at `now`. */
const frame = (now: number, patch: Partial<SpectrumFrame> = {}): SpectrumFrame => ({
  attached: true,
  shown: true,
  running: true,
  peak: 0,
  now,
  ...patch,
});

describe('the spectrum gate', () => {
  it('runs the analyser while the card is on screen and the transport plays, and draws every frameMs', () => {
    const gate = createSpectrumGate();
    expect(gate.step(frame(0))).toEqual({ active: true, draw: true });
    expect(gate.step(frame(V.frameMs / 2))).toEqual({ active: true, draw: false });
    expect(gate.step(frame(V.frameMs))).toEqual({ active: true, draw: true });
    expect(gate.step(frame(V.frameMs + 1))).toEqual({ active: true, draw: false });
  });

  it('is off while the card is off the page (folded, paged away or removed) or its tab is hidden', () => {
    const gate = createSpectrumGate();
    expect(gate.step(frame(0, { attached: false }))).toEqual({ active: false, draw: false });
    expect(gate.step(frame(10, { shown: false }))).toEqual({ active: false, draw: false });
    // Back on screen, it draws at once rather than waiting out the frame.
    expect(gate.step(frame(20))).toEqual({ active: true, draw: true });
  });

  it('is off while nothing sounds, on for the audition, and holds through a short gap', () => {
    const gate = createSpectrumGate();
    const quiet = { running: false, peak: 0 };
    expect(gate.step(frame(0, quiet)).active, 'silence, transport stopped').toBe(false);
    expect(gate.step(frame(100, { running: false, peak: V.heardPeak })).active, 'a note').toBe(
      true,
    );
    expect(gate.step(frame(100 + V.holdMs, quiet)).active, 'the hold').toBe(true);
    expect(gate.step(frame(101 + V.holdMs, quiet)).active, 'after the hold').toBe(false);
    expect(gate.step(frame(200 + V.holdMs, { running: false, peak: V.heardPeak / 2 })).active).toBe(
      false,
    );
  });
});

describe('the spectrum levels', () => {
  const plot = eqPlot(12, 48000);
  const binHz = 48000 / EQ_SPECTRUM.fftSize;
  const bins = new Float32Array(EQ_SPECTRUM.fftSize / 2);
  const out = new Float64Array(Math.floor(plot.width / V.step) + 1);

  it('writes one height per step of the plot, the floor at the bottom and 0 dBFS at the top', () => {
    bins.fill(V.floorDb);
    const n = spectrumLevels(bins, binHz, plot, out);
    expect(n).toBe(out.length);
    expect([...out.subarray(0, n)].every((y) => y === plot.height)).toBe(true);
    bins.fill(0);
    spectrumLevels(bins, binHz, plot, out);
    expect([...out].every((y) => y === 0)).toBe(true);
    bins.fill(-Infinity);
    spectrumLevels(bins, binHz, plot, out);
    expect([...out].every((y) => y === plot.height)).toBe(true);
  });

  it('draws a notch as a dip where its frequency sits, and a loud bin as a peak', () => {
    bins.fill(-30);
    const notch = Math.round(1240 / binHz);
    // A Q 8 notch at 1240 Hz is about 155 Hz wide at −3 dB: thirteen bins.
    for (let k = notch - 6; k <= notch + 6; k++) bins[k] = -80;
    const peak = Math.round(8000 / binHz);
    bins[peak] = -6;
    spectrumLevels(bins, binHz, plot, out);
    const col = (hz: number): number => {
      let best = 0;
      for (let i = 0; i < out.length; i++)
        if (Math.abs(freqOfX(i * V.step, plot) - hz) < Math.abs(freqOfX(best * V.step, plot) - hz))
          best = i;
      return best;
    };
    const level = (db: number): number => plot.height * (1 - (db - V.floorDb) / -V.floorDb);
    expect(out[col(1240)]).toBeGreaterThan(level(-60));
    expect(out[col(500)]).toBeCloseTo(level(-30), 6);
    // Many bins to a column up there: the loudest one shows.
    expect(out[col(8000)]).toBeCloseTo(level(-6), 6);
  });
});
