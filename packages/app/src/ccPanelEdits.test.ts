/**
 * The MIDI CC panel's mapping edits (windsor#784, record
 * `2026-10-13-midi-cc-mapping` decisions 1 and 5): each touches its own
 * mapping and returns the whole list.
 */
import { type CcMapping, requireCatalogRow } from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import { withInverted, withRangeEnd, withSource, withoutMapping } from './ccPanelEdits';

const LEVEL: CcMapping = {
  source: { device: 'Keys', channel: 1, cc: 71 },
  target: 'voice.ops.0.level',
  min: 0,
  max: 1,
  inverted: false,
};
const PAN: CcMapping = { ...LEVEL, source: { ...LEVEL.source, cc: 10 }, target: 'strip.pan' };
const LIST = [LEVEL, PAN];

describe('the mapping edits', () => {
  it('widens a device or channel to Any and back, on its own row only', () => {
    const any = withSource(LIST, 'strip.pan', { device: null, channel: null });
    expect(any[1]?.source).toEqual({ device: null, channel: null, cc: 10 });
    expect(any[0]).toBe(LEVEL);
    expect(withSource(any, 'strip.pan', { device: 'Keys' })[1]?.source.device).toBe('Keys');
  });

  it('flips Inv, sets a range end clamped to the row, and removes a mapping', () => {
    expect(withInverted(LIST, 'voice.ops.0.level')[0]?.inverted).toBe(true);
    const row = requireCatalogRow('voice.ops.0.level');
    expect(withRangeEnd(LIST, 'voice.ops.0.level', 'max', 3, row)[0]?.max).toBe(row.max);
    expect(withRangeEnd(LIST, 'voice.ops.0.level', 'min', 0.25, row)[0]?.min).toBe(0.25);
    expect(withoutMapping(LIST, 'voice.ops.0.level')).toEqual([PAN]);
  });
});
