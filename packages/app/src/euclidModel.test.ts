import { describe, expect, it } from 'vitest';

import type { EuclideanSpec } from '@windsor/engine';
import {
  DEFAULT_EUCLIDEAN_CONFIG,
  DIVISORS,
  PPQ,
  euclid,
  patternFromString,
} from '@windsor/engine';
import { pulseDefault } from './sequencerKnobTables';
import {
  EUCLID_STEPS_MAX,
  countOnsets,
  previewFigure,
  pulsesChange,
  rotateChange,
  stepsChange,
  stepsPerBeat,
  toggleStep,
} from './euclidModel';

const SPEC: EuclideanSpec = {
  kind: 'euclidean',
  seed: 0,
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

  it('resizes the ratchet row with the steps: padded with 1, or trimmed (windsor#356)', () => {
    const ratchets = [1, 2, 1, 1, 3, 1, 1, 1, 1, 1, 1, 1, 4, 1, 1, 1];
    const longer = stepsChange({ ...SPEC, ratchets }, 18).ratchets;
    expect(longer).toEqual([...ratchets, 1, 1]);
    expect(stepsChange({ ...SPEC, ratchets }, 5).ratchets).toEqual([1, 2, 1, 1, 3]);
    // No row stays no row, and a row already the right length is not sent.
    expect(stepsChange(SPEC, 12)).not.toHaveProperty('ratchets');
    expect(stepsChange({ ...SPEC, ratchets: [1, 2] }, 2)).not.toHaveProperty('ratchets');
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

  it('groups the strip by the beat only where the step divides it', () => {
    expect(stepsPerBeat(DIVISORS.sixteenth)).toBe(PPQ / DIVISORS.sixteenth);
    expect(stepsPerBeat(DIVISORS.quarter)).toBe(1);
    expect(stepsPerBeat(DIVISORS.bar)).toBe(0);
    expect(stepsPerBeat(0)).toBe(0);
  });
});

/**
 * The card's own reset values, not the model's (#617), but this is where the
 * Euclidean part's numbers are pinned. `knob.ts` writes `spec.def` into the
 * document on a double-click, so a default the card restates wrongly is an
 * edit the player never asked for: the card carried `{ min: 2, max: 9,
 * start: 4 }` against a sequencer that starts at `{ min: 3, max: 9, start: 5 }`.
 */
describe("the Euclidean card's k defaults", () => {
  it("are the engine's own, so a double-click reset writes what the part starts at", () => {
    const engine = DEFAULT_EUCLIDEAN_CONFIG.pulses;
    expect(pulseDefault('min')).toBe(engine.min);
    expect(pulseDefault('max')).toBe(engine.max);
    expect(pulseDefault('start')).toBe(engine.start);
  });

  it('reset a spec back to a figure the sequencer would itself have made', () => {
    // The reset is only meaningful if the engine's own bounds are consistent:
    // `start` inside `[min, max]`, and both inside the strip.
    const { min, max, start } = DEFAULT_EUCLIDEAN_CONFIG.pulses;
    expect(min).toBeLessThanOrEqual(start);
    expect(start).toBeLessThanOrEqual(max);
    expect(max).toBeLessThanOrEqual(EUCLID_STEPS_MAX);
  });
});
