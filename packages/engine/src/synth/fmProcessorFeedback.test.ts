/**
 * Bipolar self-feedback (#529): positive feedback moves a sine towards a
 * sawtooth, negative towards a square, and neither +1 nor −1 reaches noise.
 * Since windsor#842 the positive side runs to 10, past the saw into noise on
 * purpose, and stays finite and within the operator's own ±1 there.
 * Measured on a lone sine operator at a low and a high note, where the
 * one-sample feedback loop behaves differently. Split out of
 * fmProcessor.test.ts for its length; the file name keeps the
 * `vitest run fmProcessor` filter.
 */
import { describe, expect, it } from 'vitest';

import { goertzel, loadProcessor, render } from '../__fixtures__/workletHarness';
import type { RenderResult } from '../__fixtures__/workletHarness';
import { WAVE, makePatch } from '../patch/patch';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK_FRAMES = 128;
const blocksFor = (seconds: number): number => Math.ceil((seconds * SR) / BLOCK_FRAMES) + 1;

const NOTES = [45, 81] as const; // A2, A5
const SETTLE_S = 0.1;
const WINDOW_S = 1;
const HIGHEST_HARMONIC = 200;

/** Share of output energy in harmonics: below this the loop is making noise. */
const MIN_HARMONIC_SHARE = 0.9;
/** A harmonic this far below the fundamental counts as absent. */
const ABSENT = 0.02;
/** A sawtooth's 2nd harmonic is 0.5 of its fundamental; a clearly saw-like tone reaches this. */
const SAW_LIKE_SECOND = 0.3;
/** A square's 3rd harmonic is 0.33; a clearly square-like tone reaches this. */
const SQUARE_LIKE_THIRD = 0.15;
/** Feedback reshapes the wave but must not push its peak past the plain sine's. */
const PEAK_TOLERANCE = 1.02;

interface Spectrum {
  h: (k: number) => number;
  harmonicShare: number;
  result: RenderResult;
}

const env = { attackTime: 0.001, decayTime: 1, sustainLevel: 1, releaseTime: 0.3 };

const spectrum = (note: number, feedback: number): Spectrum => {
  const f0 = 440 * Math.pow(2, (note - 69) / 12);
  const processor = loaded.create(
    makePatch({ ops: [{ wave: WAVE.SINE, level: 1, feedback, env }] }),
    4,
  );
  render(loaded, processor, blocksFor(SETTLE_S), [
    { type: 'noteOn', id: 1, note, velocity: 1, frame: 0 },
  ]);
  const result = render(loaded, processor, blocksFor(WINDOW_S));
  const frames = result.samples.length / 2;
  let total = 0;
  for (let i = 0; i < result.samples.length; i += 2) total += (result.samples[i] ?? 0) ** 2;
  const magnitude = (k: number): number => goertzel(result.samples, f0 * k, SR);
  let harmonic = 0;
  // goertzel returns half the partial's amplitude, so its power is 2·g².
  for (let k = 1; k * f0 < SR / 2 && k <= HIGHEST_HARMONIC; k++) harmonic += 2 * magnitude(k) ** 2;
  const fundamental = magnitude(1);
  return {
    h: (k) => magnitude(k) / fundamental,
    harmonicShare: harmonic / (total / frames),
    result,
  };
};

describe.each(NOTES)('self-feedback at note %i', (note) => {
  const sine = spectrum(note, 0);

  it('is a pure sine at 0', () => {
    expect(sine.h(2)).toBeLessThan(ABSENT);
    expect(sine.h(3)).toBeLessThan(ABSENT);
  });

  it('moves towards a sawtooth at +1 without turning to noise', () => {
    const saw = spectrum(note, 1);
    expect(saw.result.nonFinite).toBe(0);
    expect(saw.harmonicShare).toBeGreaterThan(MIN_HARMONIC_SHARE);
    expect(saw.h(2)).toBeGreaterThan(SAW_LIKE_SECOND);
    expect(saw.result.peak).toBeLessThanOrEqual(sine.result.peak * PEAK_TOLERANCE);
  });

  it('moves towards a square at -1: odd harmonics only, without turning to noise', () => {
    const square = spectrum(note, -1);
    expect(square.result.nonFinite).toBe(0);
    expect(square.harmonicShare).toBeGreaterThan(MIN_HARMONIC_SHARE);
    expect(square.h(2)).toBeLessThan(ABSENT);
    expect(square.h(4)).toBeLessThan(ABSENT);
    expect(square.h(3)).toBeGreaterThan(SQUARE_LIKE_THIRD);
    expect(square.result.peak).toBeLessThanOrEqual(sine.result.peak * PEAK_TOLERANCE);
  });

  it('clamps past the top of the range to 10 (windsor#842)', () => {
    const past = spectrum(note, 12);
    expect(past.result.samples).toEqual(spectrum(note, 10).result.samples);
  });
});

/** The top of the range (windsor#842): a full-level operator at A2 and A6, held for 2 s. */
const TOP_NOTES = [45, 93] as const;
const TOP_SECONDS = 2;
/** The sine's amplitude, as read off its fundamental, is the voice gain; the loop's peak stays under it. */
const GAIN_TOLERANCE = 1e-6;

describe.each(TOP_NOTES)('feedback 10 at note %i', (note) => {
  const held = (feedback: number): RenderResult =>
    render(
      loaded,
      loaded.create(makePatch({ ops: [{ wave: WAVE.SINE, level: 1, feedback, env }] }), 4),
      blocksFor(TOP_SECONDS),
      [{ type: 'noteOn', id: 1, note, velocity: 1, frame: 0 }],
    );

  it('renders finite output whose peak stays within the operator’s ±1 before the voice gain', () => {
    const f0 = 440 * Math.pow(2, (note - 69) / 12);
    const top = held(10);
    expect(top.nonFinite).toBe(0);
    expect(top.samples.every((x) => Number.isFinite(x))).toBe(true);
    // goertzel returns half a partial's amplitude: the plain sine's amplitude is the voice gain.
    const sine = spectrum(note, 0).result;
    const gain = 2 * goertzel(sine.samples, f0, SR);
    expect(top.peak).toBeGreaterThan(0);
    expect(top.peak).toBeLessThanOrEqual(gain * (1 + GAIN_TOLERANCE));
  });
});
