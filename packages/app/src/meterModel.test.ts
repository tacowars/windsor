/**
 * The master column's meter rules (windsor#193 decision 2): scale positions,
 * the fall and the hold, and the readouts, pinned to the mockup's spec.
 */
import { describe, expect, it } from 'vitest';

import {
  amplitudeToDb,
  dbToAmplitude,
  elapsedSeconds,
  meterPosition,
  peakHoldTranslatePx,
  peakReadout,
  reductionHoldTranslatePx,
  reductionPosition,
  reductionReadout,
  restingMeter,
  stepMeter,
  zoneGradient,
} from './meterModel';
import {
  METER_BALLISTICS,
  METER_HOLD_LINE_PX,
  METER_SCALE,
  REDUCTION_BALLISTICS,
  REDUCTION_SCALE,
} from './meterTables';

const FLOOR = METER_SCALE.floorDb;

describe('meterPosition', () => {
  it('puts the floor at 0, the top at 1, and the rest on the 1.6 power curve', () => {
    expect(meterPosition(FLOOR)).toBe(0);
    expect(meterPosition(-12)).toBeCloseTo(Math.pow(48 / 66, 1.6), 12);
    expect(meterPosition(0)).toBeCloseTo(Math.pow(60 / 66, 1.6), 12);
    expect(meterPosition(6)).toBe(1);
  });

  it('clamps past either end, and reads silence as the floor', () => {
    expect(meterPosition(-Infinity)).toBe(0);
    expect(meterPosition(-90)).toBe(0);
    expect(meterPosition(12)).toBe(1);
    expect(meterPosition(Number.NaN)).toBe(0);
  });

  it('places the gain reduction from the top of its 12 dB bar', () => {
    expect(reductionPosition(0)).toBe(0);
    expect(reductionPosition(3)).toBe(0.25);
    expect(reductionPosition(20)).toBe(1);
    expect(reductionPosition(Number.NaN)).toBe(0);
  });
});

describe('the hold lines', () => {
  const HEIGHT = 210;

  it('keeps a full-scale peak hold inside the top of the bar', () => {
    // The line sits at the bottom and moves up; its top edge is at
    // HEIGHT - thickness + translate from the bar's top.
    const translate = peakHoldTranslatePx(METER_SCALE.ceilingDb, HEIGHT);
    expect(translate).toBe(-(HEIGHT - METER_HOLD_LINE_PX));
    expect(HEIGHT - METER_HOLD_LINE_PX + translate).toBe(0);
    expect(peakHoldTranslatePx(METER_SCALE.ceilingDb + 6, HEIGHT)).toBe(translate);
  });

  it('keeps a full-scale reduction hold inside the bottom of the bar', () => {
    // The line sits at the top and moves down; its bottom edge is at
    // thickness + translate from the bar's top.
    const translate = reductionHoldTranslatePx(REDUCTION_SCALE.maxDb, HEIGHT);
    expect(translate).toBe(HEIGHT - METER_HOLD_LINE_PX);
    expect(METER_HOLD_LINE_PX + translate).toBe(HEIGHT);
    expect(reductionHoldTranslatePx(REDUCTION_SCALE.maxDb + 6, HEIGHT)).toBe(translate);
  });

  it('moves either line by its scale position below full scale', () => {
    expect(peakHoldTranslatePx(-12, HEIGHT)).toBeCloseTo(-meterPosition(-12) * HEIGHT, 12);
    expect(peakHoldTranslatePx(-Infinity, HEIGHT)).toBe(-0);
    expect(reductionHoldTranslatePx(3, HEIGHT)).toBe(HEIGHT / 4);
    expect(reductionHoldTranslatePx(0, HEIGHT)).toBe(0);
  });
});

describe('amplitude and dB', () => {
  it('reads silence as −∞ and unity as 0 dB, and back', () => {
    expect(amplitudeToDb(0)).toBe(-Infinity);
    expect(amplitudeToDb(1)).toBe(0);
    expect(amplitudeToDb(0.5)).toBeCloseTo(-6.0206, 4);
    expect(dbToAmplitude(-Infinity)).toBe(0);
    expect(dbToAmplitude(amplitudeToDb(1.7))).toBeCloseTo(1.7, 12);
  });
});

describe('stepMeter', () => {
  it('attacks at once and falls at 24 dB a second', () => {
    let state = stepMeter(restingMeter(), -6, 0);
    expect(state.shownDb).toBe(-6);
    state = stepMeter(state, -40, 0.25);
    expect(state.shownDb).toBeCloseTo(-12, 12);
    state = stepMeter(state, -3, 0.25);
    expect(state.shownDb).toBe(-3);
  });

  it('falls no further than the floor', () => {
    let state = stepMeter(restingMeter(), 0, 0);
    for (let i = 0; i < 10; i++) state = stepMeter(state, -Infinity, 1);
    expect(state.shownDb).toBe(FLOOR);
    expect(stepMeter(state, -Infinity, 1).shownDb).toBe(FLOOR);
  });

  it('holds a peak for one second, then follows the peak', () => {
    let state = stepMeter(restingMeter(), -6, 0);
    for (let i = 0; i < 3; i++) {
      state = stepMeter(state, -20, 0.25);
      expect(state.heldDb).toBe(-6);
    }
    state = stepMeter(state, -20, 0.25);
    expect(state.heldDb).toBe(-20);
    state = stepMeter(state, -30, 0.25);
    expect(state.heldDb).toBe(-20);
  });

  it('takes a louder peak into the hold at once and restarts its second', () => {
    let state = stepMeter(restingMeter(), -20, 0);
    state = stepMeter(state, -10, 0.75);
    expect(state).toMatchObject({ heldDb: -10, heldSeconds: 0 });
    state = stepMeter(state, -30, 0.75);
    expect(state.heldDb).toBe(-10);
  });

  it('runs the gain-reduction bar on the same rules towards 0', () => {
    let state = stepMeter(restingMeter(REDUCTION_BALLISTICS), 6, 0, REDUCTION_BALLISTICS);
    state = stepMeter(state, 0, 0.125, REDUCTION_BALLISTICS);
    expect(state.shownDb).toBeCloseTo(3, 12);
    state = stepMeter(state, 0, 1, REDUCTION_BALLISTICS);
    expect(state.shownDb).toBe(0);
  });

  it('reads a frame gap in seconds, 0 on the first frame or a step back', () => {
    expect(elapsedSeconds(null, 500)).toBe(0);
    expect(elapsedSeconds(1000, 1250)).toBe(0.25);
    expect(elapsedSeconds(1000, 900)).toBe(0);
    expect(METER_BALLISTICS.holdSeconds).toBe(1);
  });
});

describe('the readouts', () => {
  it('reads silence, −0.04, 0 and +1.25 dBFS', () => {
    expect(peakReadout(-Infinity)).toBe('−∞');
    expect(peakReadout(FLOOR - 0.1)).toBe('−∞');
    expect(peakReadout(-0.04)).toBe('−0.0');
    expect(peakReadout(0)).toBe('0.0');
    expect(peakReadout(1.25)).toBe('+1.3');
    expect(peakReadout(-12.34)).toBe('−12.3');
  });

  it('reads a reduction as a cut, none as 0.0, and an off gauge as a dash', () => {
    expect(reductionReadout(4.26, false)).toBe('−4.3');
    expect(reductionReadout(0.01, false)).toBe('0.0');
    expect(reductionReadout(-Infinity, false)).toBe('0.0');
    expect(reductionReadout(4, true)).toBe('—');
  });
});

describe('zoneGradient', () => {
  it('draws hard edges at −12 and 0 dBFS', () => {
    const amber = (meterPosition(-12) * 100).toFixed(1);
    const red = (meterPosition(0) * 100).toFixed(1);
    expect(zoneGradient('to top')).toBe(
      `linear-gradient(to top, var(--modulator) 0 ${amber}%, ` +
        `var(--carrier) ${amber}% ${red}%, var(--hot) ${red}% 100%)`,
    );
  });
});
