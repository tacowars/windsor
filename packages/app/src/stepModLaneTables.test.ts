/** The lane labels (windsor#31) cover the engine's table exactly, each named once. */
import { describe, expect, it } from 'vitest';

import { STEP_MOD_PARAMS } from '@windsor/engine';
import { LANE_PAINT, STEP_MOD_LANE_LABELS } from './stepModLaneTables';

describe('STEP_MOD_LANE_LABELS', () => {
  it('names every parameter the engine can modulate, and nothing else', () => {
    for (const param of STEP_MOD_PARAMS) {
      expect(STEP_MOD_LANE_LABELS[param]?.label, param).toMatch(/\S/);
    }
    expect(Object.keys(STEP_MOD_LANE_LABELS).sort()).toEqual([...STEP_MOD_PARAMS].sort());
  });

  it('gives each parameter its own name', () => {
    const labels = Object.values(STEP_MOD_LANE_LABELS).map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('formats a played value', () => {
    expect(STEP_MOD_LANE_LABELS['filter.cutoff'].fmt(1200)).toBe('1.20k');
    expect(STEP_MOD_LANE_LABELS['ops.1.level'].fmt(0.5)).toBe('0.50');
  });

  it('snaps within a band wider than one grid step and narrower than the travel', () => {
    expect(LANE_PAINT.snapBand).toBeGreaterThan(1 / LANE_PAINT.divisions);
    expect(LANE_PAINT.snapBand).toBeLessThan(1);
  });
});
