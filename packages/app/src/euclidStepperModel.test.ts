/**
 * The Euclid card's Play steppers (windsor#356): each press writes through
 * the knobs' model functions, and stops or wraps at its limits.
 */
import { describe, expect, it } from 'vitest';

import type { EuclideanSpec } from '@windsor/engine';
import { DEFAULT_EUCLIDEAN_CONFIG, MIDI_NOTE_MAX } from '@windsor/engine';
import { EUCLID_STEPS_MAX, stepsChange } from './euclidModel';
import { EUCLID_STEPPERS, noteStep, noteText, rotateStep, stepsStep } from './euclidStepperModel';

const SPEC: EuclideanSpec = {
  ...DEFAULT_EUCLIDEAN_CONFIG,
  kind: 'euclidean',
  note: 50,
  hold: 0.1,
  steps: 16,
  rotate: 0,
  pulses: { min: 4, max: 9, start: 7 },
  density: { kind: 'lfoBars', bars: 8, shape: 'tri' },
  pattern: null,
};

describe('the Note stepper', () => {
  it('reads name and number', () => {
    expect(noteText(50)).toBe('D3 · 50');
    expect(EUCLID_STEPPERS.note.text(SPEC)).toBe('D3 · 50');
  });

  it('moves one semitone', () => {
    expect(noteStep(SPEC, 1)).toEqual({ note: 51 });
    expect(noteStep(SPEC, -1)).toEqual({ note: 49 });
  });

  it('stops at 0 and 127', () => {
    expect(noteStep({ ...SPEC, note: 0 }, -1)).toBeNull();
    expect(noteStep({ ...SPEC, note: 0 }, 1)).toEqual({ note: 1 });
    expect(noteStep({ ...SPEC, note: MIDI_NOTE_MAX }, 1)).toBeNull();
    expect(noteStep({ ...SPEC, note: MIDI_NOTE_MAX }, -1)).toEqual({ note: 126 });
    expect(MIDI_NOTE_MAX).toBe(127);
  });
});

describe('the Steps stepper', () => {
  it('writes what a Steps turn writes, the k bounds and ratchets carried along', () => {
    const ratcheted = { ...SPEC, ratchets: new Array<number>(16).fill(2) };
    expect(stepsStep(ratcheted, 1)).toEqual(stepsChange(ratcheted, 17));
    expect(stepsStep(ratcheted, 1)).toMatchObject({
      steps: 17,
      ratchets: [...ratcheted.ratchets, 1],
    });
    const tight = { ...SPEC, steps: 9, rotate: 9 };
    expect(stepsStep(tight, -1)).toEqual({
      steps: 8,
      pulses: { min: 4, max: 8, start: 7 },
      rotate: 8,
    });
  });

  it('stops at 1 and the maximum', () => {
    const one = { ...SPEC, steps: 1, rotate: 0, pulses: { min: 1, max: 1, start: 1 } };
    expect(stepsStep(one, -1)).toBeNull();
    expect(stepsStep(one, 1)).toEqual({ steps: 2 });
    const most = { ...SPEC, steps: EUCLID_STEPS_MAX };
    expect(stepsStep(most, 1)).toBeNull();
    expect(stepsStep(most, -1)).toEqual(stepsChange(most, EUCLID_STEPS_MAX - 1));
  });
});

describe('the Rotate stepper', () => {
  it('moves one step', () => {
    expect(rotateStep({ ...SPEC, rotate: 3 }, 1)).toEqual({ rotate: 4 });
    expect(rotateStep({ ...SPEC, rotate: 3 }, -1)).toEqual({ rotate: 2 });
  });

  it('wraps within the steps both ways', () => {
    expect(rotateStep({ ...SPEC, rotate: 0 }, -1)).toEqual({ rotate: 15 });
    expect(rotateStep({ ...SPEC, rotate: 15 }, 1)).toEqual({ rotate: 0 });
    // A turn the old knob left negative comes back into 0 … steps − 1.
    expect(rotateStep({ ...SPEC, rotate: -3 }, 1)).toEqual({ rotate: 14 });
  });

  it('has nowhere to go in one step', () => {
    const one = { ...SPEC, steps: 1, rotate: 0 };
    expect(rotateStep(one, 1)).toBeNull();
    expect(rotateStep(one, -1)).toBeNull();
  });
});
