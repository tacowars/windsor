/** The lane painting tunables (windsor#31). */
import { describe, expect, it } from 'vitest';

import { LANE_PAINT } from './stepModLaneTables';

describe('LANE_PAINT', () => {
  it('snaps within a band wider than one grid step and narrower than the travel', () => {
    expect(LANE_PAINT.snapBand).toBeGreaterThan(1 / LANE_PAINT.divisions);
    expect(LANE_PAINT.snapBand).toBeLessThan(1);
  });
});
