/**
 * The frozen column's press guard (windsor#157, windsor#534 decision 9): a
 * press left of the timeline's visible edge is dropped unless it is on one
 * of the frozen column's blocks.
 */
import { describe, expect, it } from 'vitest';

import { pressInFrozenGap } from './songFrozenColumns';

const AT = { onFrozenCell: false, frozenRight: 300, gapPx: 8 };

describe('the frozen column’s press guard', () => {
  it('drops a press in the gap after the column and in the padding left of it', () => {
    expect(pressInFrozenGap({ ...AT, clientX: 304 })).toBe(true);
    expect(pressInFrozenGap({ ...AT, clientX: 2 })).toBe(true);
  });

  it('passes a press on a frozen block', () => {
    expect(pressInFrozenGap({ ...AT, onFrozenCell: true, clientX: 250 })).toBe(false);
  });

  it('passes a press on the timeline, from the gap’s far edge on', () => {
    expect(pressInFrozenGap({ ...AT, clientX: 308 })).toBe(false);
    expect(pressInFrozenGap({ ...AT, clientX: 900 })).toBe(false);
  });

  it('passes everything when no frozen column is drawn', () => {
    expect(pressInFrozenGap({ ...AT, frozenRight: null, clientX: 4 })).toBe(false);
  });
});
