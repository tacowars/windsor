/**
 * Step variation's maths (windsor#935): the inverse normal CDF against
 * reference values, the bounded draw's spread and bound, the fixed draw
 * count, the flip's beat weighting, the octave shift's symmetry and MIDI
 * bounds, the borrow offset, the nearest note, velocity and gate clamps,
 * and the config check. The sequencers' use of it is
 * `gridSequencerVariation.test.ts` and `arpeggiatorVariation.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { GATE_MIN } from '../audioConstants';
import { mulberry32 } from './mulberry32';
import {
  assertStepVariation,
  boundedNormal,
  flips,
  inverseNormalCdf,
  jumpOffset,
  nearestIndex,
  octaveShift,
  shiftOctaveWithin,
  variationAt,
  variationFlipsRests,
  variationMovesPitch,
  variedGate,
  variedVelocity,
  type StepDraw,
} from './stepVariation';
import {
  STEP_VARIATION_DEFAULTS,
  STEP_VARIATION_DRAWS,
  STEP_VARIATION_TABLE as T,
} from './stepVariationConstants';

const draw = (over: Partial<StepDraw> = {}): StepDraw => ({
  flip: 0.5,
  velocity: 0,
  pitch: 0,
  gate: 0,
  ...over,
});
const counting = (values: readonly number[]) => {
  let i = 0;
  const rng = () => values[i++ % values.length]!;
  return Object.assign(rng, { count: () => i });
};

describe('the normal draw', () => {
  it('matches the inverse normal CDF to 1e-7 at reference points', () => {
    const reference: [number, number][] = [
      [0.5, 0],
      [0.975, 1.959963984540054],
      [0.84134474606854, 1],
      [0.01, -2.326347874040841],
      [0.001, -3.090232306167814],
      [0.99, 2.326347874040841],
    ];
    for (const [p, z] of reference) expect(inverseNormalCdf(p)).toBeCloseTo(z, 7);
  });

  it('keeps every z inside the Z_TAIL bound, with a standard deviation of about 0.96', () => {
    const bound = -inverseNormalCdf(T.zTail);
    expect(bound).toBeCloseTo(2.66, 2);
    expect(boundedNormal(0)).toBeCloseTo(-bound, 12);
    const rng = mulberry32(17);
    const zs = Array.from({ length: 200000 }, () => boundedNormal(rng()));
    expect(zs.reduce((m, z) => Math.max(m, Math.abs(z)), 0)).toBeLessThanOrEqual(bound);
    const mean = zs.reduce((a, z) => a + z, 0) / zs.length;
    const sd = Math.sqrt(zs.reduce((a, z) => a + (z - mean) ** 2, 0) / zs.length);
    expect(mean).toBeCloseTo(0, 2);
    expect(sd).toBeGreaterThan(0.95);
    expect(sd).toBeLessThan(0.98);
  });
});

describe('the draws', () => {
  it('draws nothing at either amount 0', () => {
    for (const config of [
      { randomness: 0, probability: 1 },
      { randomness: 1, probability: 0 },
    ]) {
      const rng = counting([0.1]);
      expect(variationAt(rng, config)).toBeNull();
      expect(rng.count()).toBe(0);
    }
  });

  it('makes its fixed draws whether the step varies or not', () => {
    const varies = counting([0.2, 0.3, 0.5, 0.5, 0.5]);
    expect(variationAt(varies, { randomness: 0.5, probability: 0.25 })).toEqual({
      flip: 0.3,
      velocity: expect.closeTo(0, 9) as number,
      pitch: expect.closeTo(0, 9) as number,
      gate: expect.closeTo(0, 9) as number,
    });
    expect(varies.count()).toBe(STEP_VARIATION_DRAWS);
    const plays = counting([0.9, 0.3, 0.5, 0.5, 0.5]);
    expect(variationAt(plays, { randomness: 0.5, probability: 0.25 })).toBeNull();
    expect(plays.count()).toBe(STEP_VARIATION_DRAWS);
  });

  it('flips only with Rests sound on, a beat at FLIP_ONBEAT × randomness and others at FLIP_OFFBEAT', () => {
    const on = { randomness: 1, restsSound: true };
    expect(flips(draw({ flip: 0.3 }), on, 4)).toBe(false);
    expect(flips(draw({ flip: 0.2 }), on, 4)).toBe(true);
    expect(flips(draw({ flip: 0.3 }), on, 5)).toBe(true);
    expect(flips(draw({ flip: 0.3 }), { ...on, randomness: 0.5 }, 5)).toBe(false);
    expect(flips(draw({ flip: 0 }), { ...on, restsSound: false }, 5)).toBe(false);
  });

  it('variationFlipsRests needs Rests sound and both amounts', () => {
    const on = { randomness: 0.5, probability: 0.5, restsSound: true };
    expect(variationFlipsRests(on)).toBe(true);
    expect(variationFlipsRests({ ...on, restsSound: false })).toBe(false);
    expect(variationFlipsRests({ ...on, probability: 0 })).toBe(false);
  });

  it('variationMovesPitch needs both amounts, whatever the switches', () => {
    expect(variationMovesPitch({ randomness: 0.1, probability: 0.1 })).toBe(true);
    expect(variationMovesPitch({ randomness: 0, probability: 1 })).toBe(false);
    expect(variationMovesPitch({ randomness: 1, probability: 0 })).toBe(false);
  });
});

describe('what a varied step does', () => {
  it('velocity: 1 + z·σ, floored and capped at 1, undefined when nothing is lost', () => {
    expect(variedVelocity(draw({ velocity: -1 }), 1)).toBeCloseTo(1 - T.velocitySigma, 12);
    expect(variedVelocity(draw({ velocity: -2.6 }), 1, { ...T, velocitySigma: 1 })).toBe(
      T.velocityFloor,
    );
    expect(variedVelocity(draw({ velocity: 1 }), 1)).toBeUndefined();
  });

  it('octave shift: symmetric rounding of z × σ × randomness', () => {
    expect(octaveShift(draw({ pitch: 1.4 }), 1)).toBe(1);
    expect(octaveShift(draw({ pitch: -1.4 }), 1)).toBe(-1);
    expect(octaveShift(draw({ pitch: 0.5 }), 1)).toBe(1);
    expect(octaveShift(draw({ pitch: -0.5 }), 1)).toBe(-1);
    expect(octaveShift(draw({ pitch: 0.4 }), 1)).toBe(0);
    expect(octaveShift(draw({ pitch: 2 }), 1, { ...T, octaveSigma: 2.25 })).toBe(5);
  });

  it('keeps a shifted note inside MIDI 0–127 by the nearest octave', () => {
    expect(shiftOctaveWithin(60, 2)).toBe(84);
    expect(shiftOctaveWithin(120, 1)).toBe(120);
    expect(shiftOctaveWithin(110, 3)).toBe(122);
    expect(shiftOctaveWithin(5, -2)).toBe(5);
    expect(shiftOctaveWithin(14, -3)).toBe(2);
  });

  it('borrow offset: z × σ × count × randomness, rounded', () => {
    expect(jumpOffset(draw({ pitch: 1 }), 1, 16, T.stepJumpSigma)).toBe(3);
    expect(jumpOffset(draw({ pitch: -1 }), 0.5, 16, T.stepJumpSigma)).toBe(-2);
    expect(jumpOffset(draw({ pitch: 1 }), 1, 1, T.stepJumpSigma)).toBe(0);
  });

  it('gate: moved by z × σ × randomness inside [GATE_MIN, 1]', () => {
    expect(variedGate(0.5, draw({ gate: 1 }), 1)).toBeCloseTo(0.5 + T.gateSigma, 12);
    expect(variedGate(0.5, draw({ gate: -2.6 }), 1)).toBe(GATE_MIN);
    expect(variedGate(0.9, draw({ gate: 2 }), 1)).toBe(1);
  });

  it('nearest index: looks both ways, earlier first, wrapping, −1 when none passes', () => {
    const notes = [false, true, false, false, true, false];
    expect(nearestIndex(1, 6, (i) => notes[i]!)).toBe(1);
    expect(nearestIndex(2, 6, (i) => notes[i]!)).toBe(1);
    expect(nearestIndex(3, 6, (i) => notes[i]!)).toBe(4);
    expect(nearestIndex(0, 6, (i) => notes[i]!)).toBe(1);
    expect(nearestIndex(5, 6, (i) => notes[i]!)).toBe(4);
    expect(nearestIndex(2, 6, () => false)).toBe(-1);
  });
});

describe('the config check', () => {
  it('takes the defaults and refuses an amount outside 0–1 or a switch that is not a boolean', () => {
    expect(() => assertStepVariation(STEP_VARIATION_DEFAULTS)).not.toThrow();
    const refused = [
      { randomness: -0.1 },
      { probability: Number.NaN },
      { octaveMode: 'yes' as unknown as boolean },
    ];
    for (const over of refused) {
      expect(() => assertStepVariation({ ...STEP_VARIATION_DEFAULTS, ...over })).toThrow(
        RangeError,
      );
    }
  });
});
