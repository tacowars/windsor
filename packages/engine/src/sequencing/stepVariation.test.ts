/**
 * Step variation's maths (windsor#935, windsor#945): the inverse normal CDF
 * against reference values, the bounded draw's spread and bound, the fixed
 * draw count, one roll or a roll per effect against Chance, the flip's beat
 * weighting, the octave shift's symmetry and MIDI
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
      { randomness: 0, probability: 1, chancePerEffect: true },
      { randomness: 1, probability: 0, chancePerEffect: false },
    ]) {
      const rng = counting([0.1]);
      expect(variationAt(rng, config)).toBeNull();
      expect(rng.count()).toBe(0);
    }
  });

  const zero = expect.closeTo(0, 9) as number;
  const ONE_ROLL = { randomness: 0.5, probability: 0.25, chancePerEffect: false };
  const PER_EFFECT = { ...ONE_ROLL, chancePerEffect: true };

  it('makes its fixed draws whether the step varies or not, whatever the switch', () => {
    for (const config of [ONE_ROLL, PER_EFFECT]) {
      const varies = counting([0.2, 0.3, 0.5, 0.5, 0.5, 0.1, 0.1, 0.1]);
      expect(variationAt(varies, config)).toEqual({
        flip: 0.3,
        velocity: zero,
        pitch: zero,
        gate: zero,
      });
      expect(varies.count()).toBe(STEP_VARIATION_DRAWS);
      const plays = counting([0.9, 0.3, 0.5, 0.5, 0.5, 0.9, 0.9, 0.9]);
      expect(variationAt(plays, config)).toBeNull();
      expect(plays.count()).toBe(STEP_VARIATION_DRAWS);
    }
  });

  it('switch off: the first roll decides everything, the effects’ own rolls unread', () => {
    expect(variationAt(counting([0.9, 0.3, 0.5, 0.5, 0.5, 0.1, 0.1, 0.1]), ONE_ROLL)).toBeNull();
    const all = variationAt(counting([0.2, 0.3, 0.5, 0.5, 0.5, 0.9, 0.9, 0.9]), ONE_ROLL);
    expect(all).toEqual({ flip: 0.3, velocity: zero, pitch: zero, gate: zero });
  });

  it('switch on: each effect is there only when its own roll passes', () => {
    const at = (values: number[]) => variationAt(counting(values), PER_EFFECT);
    expect(at([0.9, 0.3, 0.5, 0.5, 0.5, 0.1, 0.9, 0.9])).toEqual({
      flip: undefined,
      velocity: zero,
      pitch: undefined,
      gate: undefined,
    });
    expect(at([0.9, 0.3, 0.5, 0.5, 0.5, 0.9, 0.1, 0.1])).toEqual({
      flip: undefined,
      velocity: undefined,
      pitch: zero,
      gate: zero,
    });
    expect(at([0.1, 0.3, 0.5, 0.5, 0.5, 0.9, 0.9, 0.9])).toEqual({
      flip: 0.3,
      velocity: undefined,
      pitch: undefined,
      gate: undefined,
    });
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
  it('velocity: an offset of z × σ × randomness, up or down, undefined at 0 or without its roll', () => {
    expect(variedVelocity(draw({ velocity: -1 }), 1)).toBeCloseTo(-T.velocitySigma, 12);
    expect(variedVelocity(draw({ velocity: 1 }), 0.5)).toBeCloseTo(T.velocitySigma / 2, 12);
    expect(variedVelocity(draw({ velocity: 0 }), 1)).toBeUndefined();
    expect(variedVelocity(draw({ velocity: undefined }), 1)).toBeUndefined();
  });

  it('an effect without its roll plays as written: no flip, no pitch move, the gate kept', () => {
    const none = draw({ flip: undefined, pitch: undefined, gate: undefined });
    expect(flips(none, { randomness: 1, restsSound: true }, 5)).toBe(false);
    expect(octaveShift(none, 1)).toBe(0);
    expect(jumpOffset(none, 1, 16, T.stepJumpSigma)).toBe(0);
    expect(variedGate(0.4, none, 1)).toBe(0.4);
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
      { chancePerEffect: 1 as unknown as boolean },
    ];
    for (const over of refused) {
      expect(() => assertStepVariation({ ...STEP_VARIATION_DEFAULTS, ...over })).toThrow(
        RangeError,
      );
    }
  });
});

describe('Chance, one roll or a roll per effect (windsor#945)', () => {
  const STEPS = 20000;
  const KEYS = ['flip', 'velocity', 'pitch', 'gate'] as const;
  type Config = Parameters<typeof variationAt>[1];
  const run = (config: Config, seed = 45, steps = STEPS) => {
    const rng = mulberry32(seed);
    return Array.from({ length: steps }, () => variationAt(rng, config));
  };
  const share = (draws: readonly (StepDraw | null)[], test: (d: StepDraw) => boolean): number =>
    draws.filter((d) => d !== null && test(d)).length / draws.length;
  const has = (key: (typeof KEYS)[number]) => (d: StepDraw) => d[key] !== undefined;

  it('switch off: the share of steps that vary is Chance, and every effect varies with it', () => {
    for (const probability of [0.1, 0.5]) {
      const draws = run({ randomness: 1, probability, chancePerEffect: false });
      expect(Math.abs(share(draws, () => true) - probability)).toBeLessThan(0.015);
      expect(draws.every((d) => d === null || KEYS.every((key) => has(key)(d)))).toBe(true);
    }
  });

  it('switch on at Chance 0.1: each roll passes on about 10% of steps, independently', () => {
    const draws = run({ randomness: 1, probability: 0.1, chancePerEffect: true });
    for (const key of KEYS) expect(Math.abs(share(draws, has(key)) - 0.1)).toBeLessThan(0.01);
    const both = share(draws, (d) => has('velocity')(d) && has('pitch')(d));
    expect(Math.abs(both - 0.01)).toBeLessThan(0.004);
    // The Grid reads velocity and pitch, the Arp its gate too: 1 − 0.9² and 1 − 0.9³.
    const grid = share(draws, (d) => has('velocity')(d) || has('pitch')(d));
    const arp = share(draws, (d) => has('velocity')(d) || has('pitch')(d) || has('gate')(d));
    expect(Math.abs(grid - 0.19)).toBeLessThan(0.015);
    expect(Math.abs(arp - 0.271)).toBeLessThan(0.015);
  });

  it('toggling the switch or moving either knob mid-stream never moves a step’s draws', () => {
    const configs: Config[] = [
      { randomness: 1, probability: 1, chancePerEffect: true },
      { randomness: 0.3, probability: 0.6, chancePerEffect: true },
      { randomness: 0.7, probability: 0.2, chancePerEffect: false },
      { randomness: 1, probability: 0.9, chancePerEffect: false },
    ];
    const reference = run({ randomness: 1, probability: 1, chancePerEffect: false }, 7, 4000);
    const rng = mulberry32(7);
    const mixed = reference.map((_, i) => variationAt(rng, configs[i % configs.length]!));
    expect(mixed.filter((d) => d !== null).length).toBeGreaterThan(1000);
    mixed.forEach((d, i) => {
      for (const key of KEYS) if (d?.[key] !== undefined) expect(d[key]).toBe(reference[i]![key]);
    });
  });
});
