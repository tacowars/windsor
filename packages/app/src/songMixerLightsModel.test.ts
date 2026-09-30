/**
 * The Song tab's mixer lights (windsor#159): the green light's brightness
 * from a peak, at the floor, between, at 0 dBFS and above; its colour ramp;
 * and the red light's latch, set on an overload, kept across a release,
 * cleared on a click and dropped on a new meter.
 */
import { describe, expect, it } from 'vitest';

import { ClipLatches, lightRamp, lightStep, peakBrightness } from './songMixerLightsModel';
import type { MixerLightTable } from './songMixerLightsTables';
import { MIXER_LIGHTS } from './songMixerLightsTables';

const dbToAmp = (db: number): number => 10 ** (db / 20);

describe('peakBrightness', () => {
  it('is dark for silence and at or below the floor', () => {
    expect(peakBrightness(0)).toBe(0);
    expect(peakBrightness(-0.5)).toBe(0);
    expect(peakBrightness(Number.NaN)).toBe(0);
    expect(peakBrightness(dbToAmp(MIXER_LIGHTS.floorDb))).toBe(0);
    expect(peakBrightness(dbToAmp(MIXER_LIGHTS.floorDb - 20))).toBe(0);
  });

  it('follows the dB scale between the floor and 0 dBFS', () => {
    const table: MixerLightTable = { ...MIXER_LIGHTS, floorDb: -60, curve: 1 };
    expect(peakBrightness(dbToAmp(-30), table)).toBeCloseTo(0.5, 9);
    expect(peakBrightness(dbToAmp(-15), table)).toBeCloseTo(0.75, 9);
    const bent: MixerLightTable = { ...table, curve: 2 };
    expect(peakBrightness(dbToAmp(-30), bent)).toBeCloseTo(0.25, 9);
    const quieter = peakBrightness(dbToAmp(-40));
    const louder = peakBrightness(dbToAmp(-10));
    expect(quieter).toBeGreaterThan(0);
    expect(louder).toBeGreaterThan(quieter);
    expect(louder).toBeLessThan(1);
  });

  it('is fully lit at 0 dBFS and above', () => {
    expect(peakBrightness(1)).toBe(1);
    expect(peakBrightness(dbToAmp(6))).toBe(1);
    expect(peakBrightness(4)).toBe(1);
  });
});

describe('lightStep and lightRamp', () => {
  it('quantises a brightness to the table’s steps, clamped', () => {
    expect(lightStep(0)).toBe(0);
    expect(lightStep(1)).toBe(MIXER_LIGHTS.steps);
    expect(lightStep(0.5)).toBe(MIXER_LIGHTS.steps / 2);
    expect(lightStep(-1)).toBe(0);
    expect(lightStep(2)).toBe(MIXER_LIGHTS.steps);
  });

  it('runs from the dark colour to the lit one, a colour a step', () => {
    const table: MixerLightTable = {
      ...MIXER_LIGHTS,
      steps: 2,
      darkColor: [0, 10, 100],
      litColor: [200, 30, 100],
    };
    expect(lightRamp(table)).toEqual(['rgb(0, 10, 100)', 'rgb(100, 20, 100)', 'rgb(200, 30, 100)']);
    expect(lightRamp()).toHaveLength(MIXER_LIGHTS.steps + 1);
  });
});

describe('ClipLatches', () => {
  const meterA = { name: 'a' };
  const meterB = { name: 'b' };
  const quiet = (revision: number) => ({ revision, overload: false });
  const clip = (revision: number) => ({ revision, overload: true });

  it('is set by an overload and stays set after the peak passes', () => {
    const latches = new ClipLatches<object | undefined>();
    expect(latches.observe(1, meterA, quiet(1))).toBe(false);
    expect(latches.observe(1, meterA, clip(2))).toBe(true);
    expect(latches.observe(1, meterA, quiet(3))).toBe(true);
    expect(latches.lit(1)).toBe(true);
    expect(latches.lit(2)).toBe(false);
  });

  it('is kept across a release, whose zeroed report shows no overload', () => {
    const latches = new ClipLatches<object | undefined>();
    latches.observe(1, meterA, clip(4));
    // setActive(false) zeroes the report and bumps the revision; the row comes back.
    expect(latches.observe(1, meterA, quiet(5))).toBe(true);
    expect(latches.observe(1, meterA, quiet(9))).toBe(true);
  });

  it('is cleared by a click, ignoring the report that may predate the reset', () => {
    const latches = new ClipLatches<object | undefined>();
    latches.observe(1, meterA, clip(4));
    latches.clear(1, 4);
    expect(latches.lit(1)).toBe(false);
    // The report already in flight still carries the worklet's old overload.
    expect(latches.observe(1, meterA, clip(4 + MIXER_LIGHTS.staleReports))).toBe(false);
    expect(latches.observe(1, meterA, quiet(6))).toBe(false);
    // A clip after the reset lights it again.
    expect(latches.observe(1, meterA, clip(7))).toBe(true);
  });

  it('is dropped when the slot’s meter is a new object or gone', () => {
    const latches = new ClipLatches<object | undefined>();
    latches.observe(1, meterA, clip(4));
    expect(latches.observe(1, meterB, quiet(0))).toBe(false);
    latches.observe(1, meterB, clip(1));
    expect(latches.observe(1, undefined, quiet(0))).toBe(false);
  });

  it('forgets the slots whose part is gone', () => {
    const latches = new ClipLatches<object | undefined>();
    latches.observe(1, meterA, clip(1));
    latches.observe(2, meterB, clip(1));
    latches.retain((slot) => slot === 2);
    expect(latches.lit(1)).toBe(false);
    expect(latches.lit(2)).toBe(true);
    // A part added back at the slot starts dark, even on the same meter object.
    expect(latches.observe(1, meterA, quiet(2))).toBe(false);
  });
});
