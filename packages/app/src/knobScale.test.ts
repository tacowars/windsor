/**
 * A knob's value ↔ sweep mapping (`scaleFor`), at a log knob's zero end
 * (windsor#324 fix rounds 1 and 2): a log knob whose `min` is 0 runs the
 * bottom `ZERO_END_SLICE` of its dial straight from exact 0 to its
 * `logFloor` and sweeps logarithmically above that, so an envelope stage of
 * 0 (windsor#316) can be dialled, shown and committed, and a knob at the old
 * minimum, or under it, keeps a position of its own that a touch does not
 * move.
 */
import { describe, expect, it } from 'vitest';

import { PRESETS } from '@windsor/engine/patch/presets';
import { keyTarget, scaleFor } from './knob';
import type { KnobScaleSpec } from './knob';
import { ZERO_END_SLICE } from './knobConstants';
import { ENVELOPE_KNOBS, FIXED_HZ_KNOB, allPatchKnobs } from './patchKnobTables';
import { getPath } from './patchPath';

const attack = ENVELOPE_KNOBS.find((k) => k.f === 'attackTime')!.o;
const decay = ENVELOPE_KNOBS.find((k) => k.f === 'decayTime')!.o;

/** Every patch knob with a zero end, by label: attack, decay, glide, the LFOs' fade-ins. */
const zeroEndKnobs = (): [string, KnobScaleSpec][] =>
  allPatchKnobs()
    .filter(({ entry }) => entry.o.curve === 'log' && entry.o.min <= 0)
    .map(({ path, entry }): [string, KnobScaleSpec] => [path, entry.o]);

/** The values a knob's round trip is checked at: 0, under its floor, its floor, a sweep across, its max. */
function valuesAcross(spec: KnobScaleSpec): number[] {
  const floor = spec.logFloor ?? scaleFor(spec).fromNorm(ZERO_END_SLICE);
  const values = [0, floor / 1000, floor / 3, floor, spec.max];
  for (let i = 1; i < 10; i++) values.push(floor * (spec.max / floor) ** (i / 10));
  return values;
}

/** Whether `v` reads back as itself: exactly at 0 and the floor, to a few ulps elsewhere. */
function expectRoundTrip(spec: KnobScaleSpec, v: number, what: string): void {
  const { toNorm, fromNorm } = scaleFor(spec);
  const back = fromNorm(toNorm(v));
  if (v === 0 || v === spec.logFloor) expect(back, what).toBe(v);
  else expect(Math.abs(back - v) / v, what).toBeLessThan(1e-12);
}

describe('a log knob with a zero end', () => {
  it('runs the bottom slice of the dial from exact 0 to the floor at the slice’s top', () => {
    const scale = scaleFor(attack);
    expect(scale.zeroTop).toBe(ZERO_END_SLICE);
    expect(scale.fromNorm(0)).toBe(0);
    expect(scale.fromNorm(-0.5)).toBe(0);
    expect(scale.fromNorm(ZERO_END_SLICE / 2)).toBeCloseTo(0.00025, 15);
    expect(scale.toNorm(0)).toBe(0);
    expect(scale.toNorm(0.0005)).toBe(ZERO_END_SLICE);
    expect(scale.fromNorm(ZERO_END_SLICE)).toBe(0.0005);
    expect(scale.fromNorm(1)).toBeCloseTo(12, 9);
  });

  it('round-trips 0, the old minimum and every value above it, on every zero-end knob', () => {
    const knobs = zeroEndKnobs();
    expect(knobs.length).toBeGreaterThanOrEqual(4);
    for (const [path, spec] of knobs) {
      for (const v of valuesAcross(spec)) expectRoundTrip(spec, v, `${path} at ${v}`);
    }
  });

  it('round-trips every value the library ships on a zero-end knob', () => {
    const knobs = allPatchKnobs().filter(
      ({ entry }) => entry.o.curve === 'log' && entry.o.min <= 0,
    );
    let checked = 0;
    for (const [id, patch] of Object.entries(PRESETS)) {
      for (const { path, entry } of knobs) {
        const v = getPath(patch, path);
        if (typeof v !== 'number') continue;
        expectRoundTrip(entry.o, v, `${id} ${path} = ${v}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps the old sweep above the floor, in the dial above the slice', () => {
    const old = scaleFor({ min: 0.001, max: 20, curve: 'log' });
    const now = scaleFor(decay);
    for (const v of [0.001, 0.05, 2, 20]) {
      expect(now.toNorm(v)).toBeCloseTo(ZERO_END_SLICE + (1 - ZERO_END_SLICE) * old.toNorm(v), 12);
    }
  });

  it('reads a value under the floor inside the slice, and an arrow down from it lands on 0', () => {
    expect(scaleFor(decay).toNorm(0.0001)).toBeCloseTo(ZERO_END_SLICE / 10, 15);
    expect(keyTarget(decay, 0.0001, -1, false)).toBe(0);
  });

  it('steps from 0 to the floor and back in one press each way', () => {
    const up = keyTarget(attack, 0, 1, false);
    expect(up).toBe(0.0005);
    expect(keyTarget(attack, up, -1, false)).toBe(0);
    expect(keyTarget(decay, keyTarget(decay, 0, 1, false), -1, false)).toBe(0);
  });

  it('steps finely inside the slice and back to exact 0', () => {
    let v = 0;
    const ups: number[] = [];
    for (let i = 0; i < 3; i++) ups.push((v = keyTarget(attack, v, 1, true)));
    expect(ups[0]).toBeCloseTo(0.00005, 15);
    expect(ups[2]).toBeCloseTo(0.00015, 15);
    for (let i = 0; i < 3; i++) v = keyTarget(attack, v, -1, true);
    expect(v).toBe(0);
  });

  it('shows 0 as 0 ms', () => {
    expect(attack.fmt?.(0)).toBe('0m');
  });

  it('leaves a log knob with a minimum above 0 bottoming out on that minimum', () => {
    const scale = scaleFor(FIXED_HZ_KNOB.o);
    expect(scale.zeroTop).toBeUndefined();
    expect(scale.fromNorm(0)).toBeCloseTo(1, 12);
    expect(FIXED_HZ_KNOB.o.fmt?.(1)).toBe('1');
  });
});
