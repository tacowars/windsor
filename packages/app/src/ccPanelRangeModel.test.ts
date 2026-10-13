/**
 * A mapping's Range ends (windsor#784, record `2026-10-13-midi-cc-mapping`
 * decision 5): dragged along the target's own scale, and typed in the units
 * its readout shows.
 */
import { requireCatalogRow } from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import { DRAG_RANGE_PX } from './knobConstants';
import { draggedValue, parseRangeText } from './ccPanelRangeModel';

const CUTOFF = requireCatalogRow('voice.filter.cutoff');
const LEVEL = requireCatalogRow('strip.level');
const PAN = requireCatalogRow('strip.pan');
const DECAY = requireCatalogRow('voice.ops.0.env.decayTime');

describe('draggedValue', () => {
  it("moves along the row's scale, up to raise, a knob's travel for the whole row", () => {
    expect(draggedValue(CUTOFF, CUTOFF.min, -DRAG_RANGE_PX, false)).toBe(CUTOFF.max);
    expect(draggedValue(CUTOFF, CUTOFF.max, DRAG_RANGE_PX * 2, false)).toBe(CUTOFF.min);
    // Half the travel from the bottom is the geometric middle: an even sweep in octaves.
    const middle = draggedValue(CUTOFF, CUTOFF.min, -DRAG_RANGE_PX / 2, false);
    expect(middle).toBeCloseTo(Math.sqrt(CUTOFF.min * CUTOFF.max), 6);
    expect(draggedValue(CUTOFF, 1000, -10, true)).toBeLessThan(
      draggedValue(CUTOFF, 1000, -10, false),
    );
  });
});

describe('parseRangeText', () => {
  it('reads each unit as its readout writes it, clamped to the row', () => {
    expect(parseRangeText(CUTOFF, '2.5 kHz')).toBe(2500);
    expect(parseRangeText(CUTOFF, '440')).toBe(440);
    expect(parseRangeText(CUTOFF, '99 kHz')).toBe(CUTOFF.max);
    expect(parseRangeText(LEVEL, '−6 dB')).toBeCloseTo(10 ** (-6 / 20), 9);
    expect(parseRangeText(LEVEL, '-∞ dB')).toBe(LEVEL.min);
    expect(parseRangeText(PAN, 'L40')).toBeCloseTo(-0.4, 9);
    expect(parseRangeText(PAN, 'C')).toBe(0);
    expect(parseRangeText(DECAY, '300 ms')).toBeCloseTo(0.3, 9);
    expect(parseRangeText(DECAY, '1.5 s')).toBe(1.5);
    expect(parseRangeText(DECAY, 'soon')).toBeUndefined();
  });
});
