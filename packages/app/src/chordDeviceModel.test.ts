/**
 * The Chord device's Steps label (windsor#369): the step count and one
 * pass in bars, durations and repeats included.
 */
import { describe, expect, it } from 'vitest';

import type { ChordSpec, ChordStep } from '@windsor/engine';
import { DEFAULT_CHORD_CONFIG, DIVISORS, hitStep, restStep } from '@windsor/engine';
import { chordBars, chordStepsLabel } from './chordDeviceModel';
import { SEQUENCER_DEVICE_PX } from './sequencerDeviceTables';

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
    expect(chordStepsLabel(spec([hitStep(), hitStep()], DIVISORS.whole))).toBe('2 · 2 bars');
  });

  it('reads an empty pattern as no bars', () => {
    expect(chordStepsLabel(spec([]))).toBe('0 · 0 bars');
  });
});

describe('the Chord device’s sizes (windsor#369)', () => {
  it('keeps the device at 244 px and the Grid’s step at 32', () => {
    expect(SEQUENCER_DEVICE_PX['--seq-h']).toBe(244);
    expect(SEQUENCER_DEVICE_PX['--step-w']).toBe(32);
  });

  it('spaces its Play columns as the mockup draws them', () => {
    expect(SEQUENCER_DEVICE_PX['--chord-inset']).toBe(12);
    expect(SEQUENCER_DEVICE_PX['--chord-col-gap']).toBe(13);
    expect(SEQUENCER_DEVICE_PX['--chord-field-w']).toBe(120);
    expect(SEQUENCER_DEVICE_PX['--chord-fields-pad']).toBe(33);
    expect(SEQUENCER_DEVICE_PX['--chord-tile-w']).toBe(110);
    expect(SEQUENCER_DEVICE_PX['--chord-tile-gap']).toBe(10);
    expect(SEQUENCER_DEVICE_PX['--chord-knob-pad']).toBe(9);
  });

  it('steps at a 48 px pitch with 21 px dials in 5 px rows', () => {
    expect(SEQUENCER_DEVICE_PX['--chord-step-w']).toBe(42);
    expect(SEQUENCER_DEVICE_PX['--chord-step-gap']).toBe(6);
    expect(SEQUENCER_DEVICE_PX['--chord-step-w']! + SEQUENCER_DEVICE_PX['--chord-step-gap']!).toBe(
      48,
    );
    expect(SEQUENCER_DEVICE_PX['--chord-dial-h']).toBe(21);
    expect(SEQUENCER_DEVICE_PX['--chord-row-gap']).toBe(5);
    expect(SEQUENCER_DEVICE_PX['--chord-strip-foot']).toBe(10);
  });
});
