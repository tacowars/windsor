/**
 * A knob's value ↔ sweep mapping (`scaleFor`), at a log knob's zero end
 * (windsor#324 fix round 1): a log knob whose `min` is 0 sweeps from its
 * `logFloor`, and the bottom of its sweep is exact 0, so an envelope stage of
 * 0 (windsor#316) can be dialled, shown and committed.
 */
import { describe, expect, it } from 'vitest';

import { keyTarget, scaleFor } from './knob';
import { ENVELOPE_KNOBS, FIXED_HZ_KNOB } from './patchKnobTables';

const attack = ENVELOPE_KNOBS.find((k) => k.f === 'attackTime')!.o;
const decay = ENVELOPE_KNOBS.find((k) => k.f === 'decayTime')!.o;

describe('a log knob with a zero end', () => {
  it('gives the bottom of the sweep to exact 0 and the floor just above it', () => {
    const scale = scaleFor(attack);
    expect(scale.fromNorm(0)).toBe(0);
    expect(scale.fromNorm(-0.5)).toBe(0);
    expect(scale.toNorm(0)).toBe(0);
    expect(scale.fromNorm(1e-9)).toBeCloseTo(0.0005, 9);
    expect(scale.fromNorm(1)).toBeCloseTo(12, 9);
  });

  it('keeps the sweep above the floor where the old minimum put it', () => {
    const old = scaleFor({ min: 0.001, max: 20, curve: 'log' });
    const now = scaleFor(decay);
    for (const n of [0.01, 0.25, 0.5, 0.9, 1]) expect(now.fromNorm(n)).toBe(old.fromNorm(n));
    for (const v of [0.001, 0.05, 2, 20]) expect(now.toNorm(v)).toBe(old.toNorm(v));
  });

  it('reads a value under the floor at the bottom, and an arrow down from it lands on 0', () => {
    expect(scaleFor(decay).toNorm(0.0001)).toBe(0);
    expect(keyTarget(decay, 0.0001, -1, false)).toBe(0);
    expect(keyTarget(attack, 0, 1, false)).toBeGreaterThan(0.0005);
  });

  it('shows 0 as 0 ms', () => {
    expect(attack.fmt?.(0)).toBe('0m');
  });

  it('leaves a log knob with a minimum above 0 bottoming out on that minimum', () => {
    expect(scaleFor(FIXED_HZ_KNOB.o).fromNorm(0)).toBeCloseTo(1, 12);
    expect(FIXED_HZ_KNOB.o.fmt?.(1)).toBe('1');
  });
});
