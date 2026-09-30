/**
 * The frozen columns' press guard (windsor#157): a press left of the
 * timeline's visible edge is dropped unless it is on a name or a mixer cell.
 */
import { describe, expect, it } from 'vitest';

import { pressInFrozenGap } from './songFrozenColumns';

const AT = { onFrozenCell: false, mixerRight: 300, gapPx: 8 };

describe('the frozen columns’ press guard', () => {
  it('drops a press in the gap after the mixer column and left of the names', () => {
    expect(pressInFrozenGap({ ...AT, clientX: 304 })).toBe(true);
    expect(pressInFrozenGap({ ...AT, clientX: 2 })).toBe(true);
  });

  it('passes a press on a frozen cell', () => {
    expect(pressInFrozenGap({ ...AT, onFrozenCell: true, clientX: 250 })).toBe(false);
  });

  it('passes a press on the timeline, from the gap’s far edge on', () => {
    expect(pressInFrozenGap({ ...AT, clientX: 308 })).toBe(false);
    expect(pressInFrozenGap({ ...AT, clientX: 900 })).toBe(false);
  });

  it('passes everything when no mixer column is drawn', () => {
    expect(pressInFrozenGap({ ...AT, mixerRight: null, clientX: 4 })).toBe(false);
  });
});
