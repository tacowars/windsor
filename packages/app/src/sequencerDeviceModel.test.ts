/**
 * The sequencer device's rail (windsor#368, record
 * `2026-10-01-sequencer-rack-devices` decision 2): the region as `n/m`,
 * Split's two-bar floor, and the fold kept per part for the session. The
 * device's height and its step rows' height are the table's.
 */
import { describe, expect, it } from 'vitest';

import { TICKS_PER_BAR } from '@windsor/engine';
import { DeviceFolds, canSplitRegion, regionBadge } from './sequencerDeviceModel';
import {
  GRID_HEAD_ROWS_PX,
  SEQUENCER_DEVICE_PX,
  STRIP_ROW_GAP_PX,
  stripHeadPx,
} from './sequencerDeviceTables';

describe('the rail’s region (windsor#368)', () => {
  it('reads the selected region as n/m', () => {
    expect(regionBadge(2, 4)).toEqual({ text: '3/4', title: 'Region 3 of 4' });
  });

  it('reads the first, which the card edits, when nothing is selected', () => {
    expect(regionBadge(null, 3)?.text).toBe('1/3');
    expect(regionBadge(null, 3)?.title).toMatch(/click a region/);
    expect(regionBadge(7, 3)?.text).toBe('1/3');
  });

  it('shows none for a part without regions', () => {
    expect(regionBadge(null, 0)).toBeNull();
  });

  it('splits a region of two bars or more, as the pane’s Split did', () => {
    expect(canSplitRegion({ duration: 2 * TICKS_PER_BAR })).toBe(true);
    expect(canSplitRegion({ duration: 2 * TICKS_PER_BAR - 1 })).toBe(false);
    expect(canSplitRegion(null)).toBe(false);
    expect(canSplitRegion(undefined)).toBe(false);
  });
});

describe('the fold (windsor#368)', () => {
  it('folds and unfolds one part’s device, leaving the others', () => {
    const folds = new DeviceFolds();
    expect(folds.isFolded(1)).toBe(false);
    expect(folds.toggle(1)).toBe(true);
    expect(folds.isFolded(1)).toBe(true);
    expect(folds.isFolded(2)).toBe(false);
    expect(folds.toggle(1)).toBe(false);
    expect(folds.isFolded(1)).toBe(false);
  });
});

describe('the device’s sizes (windsor#368)', () => {
  it('is 244 px high, with 32 px steps and 42 px lanes', () => {
    expect(SEQUENCER_DEVICE_PX['--seq-h']).toBe(244);
    expect(SEQUENCER_DEVICE_PX['--step-w']).toBe(32);
    expect(SEQUENCER_DEVICE_PX['--lane-h']).toBe(42);
  });

  it('holds the step rows at their own height, so the names corner matches them', () => {
    const rows = GRID_HEAD_ROWS_PX.reduce((a, b) => a + b, 0);
    const gaps = STRIP_ROW_GAP_PX * (GRID_HEAD_ROWS_PX.length - 1);
    expect(stripHeadPx()).toBe(rows + gaps);
    expect(SEQUENCER_DEVICE_PX['--strip-head-h']).toBe(stripHeadPx());
  });
});
