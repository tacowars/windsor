/**
 * The Chord device's Steps label (windsor#369): the step count and one
 * pass in bars, durations and repeats included.
 */
import { describe, expect, it } from 'vitest';

import type { ChordSpec, ChordStep } from '@windsor/engine';
import { DEFAULT_CHORD_CONFIG, DIVISORS, hitStep, restStep } from '@windsor/engine';
import { chordBars, chordStepsLabel } from './chordDeviceModel';

const spec = (steps: ChordStep[], divisor: number = DIVISORS.eighth): ChordSpec => ({
  kind: 'chord',
  ...DEFAULT_CHORD_CONFIG,
  divisor,
  steps,
});

describe('the Chord device’s Steps label (windsor#369)', () => {
  it('reads eight eighths as one bar', () => {
    const steps = Array.from({ length: 8 }, (_, i) => (i % 2 ? restStep() : hitStep()));
    expect(chordStepsLabel(spec(steps))).toBe('8 · 1 bar');
  });

  it('counts durations and repeats in the pass', () => {
    const steps = [hitStep({ duration: 2, repeat: 3 }), restStep({ duration: 0.5 })];
    // (2 × 3 + 0.5) eighths = 6.5 / 8 of a bar.
    expect(chordBars(spec(steps))).toBe('0.81');
    expect(chordStepsLabel(spec(steps))).toBe('2 · 0.81 bars');
  });

  it('reads a whole number of bars without places', () => {
    expect(chordStepsLabel(spec([hitStep(), hitStep()], DIVISORS.bar))).toBe('2 · 2 bars');
  });

  it('reads an empty pattern as no bars', () => {
    expect(chordStepsLabel(spec([]))).toBe('0 · 0 bars');
  });
});
