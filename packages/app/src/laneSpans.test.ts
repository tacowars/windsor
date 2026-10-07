/**
 * Which lane a pointer's height lands on (record
 * `2026-10-07-song-region-drag-across-parts` decision 1): the span holding
 * it, the nearer neighbour in a gap, and none above or below the lanes.
 */
import { describe, expect, it } from 'vitest';

import { laneAtY } from './laneSpans';

describe('the lane under a pointer', () => {
  // Out of order on purpose, with a 4 px gap after each lane and one folded (empty) row.
  const spans = [
    { top: 144, bottom: 184, key: 'drums' },
    { top: 100, bottom: 140, key: 'lead' },
    { top: 160, bottom: 160, key: 'folded' },
    { top: 56, bottom: 96, key: 'harmony' },
  ];

  it('is the lane holding y, its top in and its bottom out', () => {
    expect(laneAtY(spans, 56)).toBe('harmony');
    expect(laneAtY(spans, 120)).toBe('lead');
    expect(laneAtY(spans, 160)).toBe('drums');
    expect(laneAtY(spans, 183.5)).toBe('drums');
  });

  it('is the nearer lane in a gap, and none above or below them all', () => {
    expect(laneAtY(spans, 141)).toBe('lead');
    expect(laneAtY(spans, 143)).toBe('drums');
    expect(laneAtY(spans, 55)).toBeNull();
    expect(laneAtY(spans, 184)).toBeNull();
    expect(laneAtY([], 0)).toBeNull();
  });
});
