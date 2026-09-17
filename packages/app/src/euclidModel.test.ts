import { describe, expect, it } from 'vitest';

import type { EuclideanSpec } from '../../../packages/client/src/audio/index-for-editor';
import {
  DIVISORS,
  PPQ,
  euclid,
  patternFromString,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  EUCLID_STEPS_MAX,
  countOnsets,
  playheadStep,
  previewFigure,
  pulsesChange,
  rotateChange,
  stepsChange,
  stepsPerBeat,
  toggleStep,
} from './euclidModel';

const SPEC: EuclideanSpec = {
  kind: 'euclidean',
  note: 36,
  hold: 0.1,
  steps: 16,
  divisor: DIVISORS.sixteenth,
  pulses: { min: 3, max: 9, start: 5 },
  rotate: 2,
  density: { kind: 'lfoBars', bars: 8, shape: 'tri' },
  pattern: null,
};

describe('stepsChange', () => {
  it('sends only steps when nothing exceeds the new n', () => {
    expect(stepsChange(SPEC, 20)).toEqual({ steps: 20 });
  });

  it('carries the pulse bounds and the rotation down with n', () => {
    expect(stepsChange(SPEC, 4)).toEqual({ steps: 4, pulses: { min: 3, max: 4, start: 4 } });
    expect(stepsChange(SPEC, 1)).toEqual({
      steps: 1,
      pulses: { min: 1, max: 1, start: 1 },
      rotate: 1,
    });
    expect(stepsChange({ ...SPEC, rotate: -12 }, 8)).toEqual({
      steps: 8,
      pulses: { min: 3, max: 8, start: 5 },
      rotate: -8,
    });
  });

  it('resizes a captured figure: cut, or padded with rests', () => {
    const fixed = { ...SPEC, pattern: patternFromString('x..x..x.x..x..x.') };
    expect(stepsChange(fixed, 12)).toMatchObject({ pattern: patternFromString('x..x..x.x..x') });
    expect(stepsChange(fixed, 18)).toMatchObject({
      pattern: patternFromString('x..x..x.x..x..x...'),
    });
    expect(stepsChange(fixed, 16)).toEqual({ steps: 16 });
  });

  it('holds n within 1 and the engine maximum', () => {
    expect(stepsChange(SPEC, 0)).toMatchObject({ steps: 1 });
    expect(stepsChange(SPEC, 999)).toMatchObject({ steps: EUCLID_STEPS_MAX });
  });
});

describe('pulsesChange', () => {
  it('min pushes max up; max pulls min down; start stays between them', () => {
    expect(pulsesChange(SPEC, 'min', 11)).toEqual({ min: 11, max: 11, start: 11 });
    expect(pulsesChange(SPEC, 'max', 2)).toEqual({ min: 2, max: 2, start: 2 });
    expect(pulsesChange(SPEC, 'start', 30)).toEqual({ min: 3, max: 9, start: 9 });
    expect(pulsesChange(SPEC, 'start', 0)).toEqual({ min: 3, max: 9, start: 3 });
  });

  it('clamps every field into the figure', () => {
    expect(pulsesChange(SPEC, 'max', 40)).toEqual({ min: 3, max: 16, start: 5 });
    expect(pulsesChange(SPEC, 'min', -4)).toEqual({ min: 0, max: 9, start: 5 });
  });
});

describe('rotateChange and toggleStep', () => {
  it('holds a rotation within ±steps and rounds it', () => {
    expect(rotateChange(SPEC, 20)).toBe(16);
    expect(rotateChange(SPEC, -20)).toBe(-16);
    expect(rotateChange(SPEC, 2.4)).toBe(2);
  });

  it('flips only the named step', () => {
    const figure = patternFromString('x...');
    expect(toggleStep(figure, 0)).toEqual(patternFromString('....'));
    expect(toggleStep(figure, 3)).toEqual(patternFromString('x..x'));
    expect(figure).toEqual(patternFromString('x...'));
  });
});

describe('the preview and the readout', () => {
  it('previews the captured figure when fixed, else E(start, n) rotated', () => {
    expect(previewFigure(SPEC)).toEqual(euclid(5, 16, 2));
    const fixed = patternFromString('x.x.x.x.');
    expect(previewFigure({ ...SPEC, steps: 8, pattern: fixed })).toBe(fixed);
    expect(countOnsets(fixed)).toBe(4);
  });

  it('places the playhead by the audible tick and wraps at the figure', () => {
    const divisor = DIVISORS.sixteenth;
    expect(playheadStep(0, divisor, 12)).toBe(0);
    expect(playheadStep(divisor * 11 + 1, divisor, 12)).toBe(11);
    expect(playheadStep(divisor * 12, divisor, 12)).toBe(0);
  });

  it('groups the strip by the beat only where the step divides it', () => {
    expect(stepsPerBeat(DIVISORS.sixteenth)).toBe(PPQ / DIVISORS.sixteenth);
    expect(stepsPerBeat(DIVISORS.quarter)).toBe(1);
    expect(stepsPerBeat(DIVISORS.bar)).toBe(0);
    expect(stepsPerBeat(0)).toBe(0);
  });
});
