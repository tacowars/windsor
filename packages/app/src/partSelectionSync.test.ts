import { describe, expect, it } from 'vitest';
import { adoptPartsPick, pickedSlot } from './partSelectionSync';
import type { SongSelection } from './songTab';

const part = (slot: number, region: number | null): SongSelection => ({
  kind: 'part',
  slot,
  region,
});
const event: SongSelection = { kind: 'event', index: 2 };

describe('adoptPartsPick', () => {
  it('keeps the view’s own selection while no new pick landed', () => {
    for (const selection of [null, event, part(4, 1)]) {
      expect(adoptPartsPick(selection, { slot: 2, picks: 3 }, 3)).toEqual({ selection, seen: 3 });
    }
  });

  it('selects a newly picked part with no region named, over an event or another part', () => {
    for (const selection of [null, event, part(4, 1)]) {
      expect(adoptPartsPick(selection, { slot: 2, picks: 4 }, 3)).toEqual({
        selection: part(2, null),
        seen: 4,
      });
    }
  });

  it('keeps the region when the new pick is the part it already selects', () => {
    expect(adoptPartsPick(part(2, 1), { slot: 2, picks: 4 }, 3)).toEqual({
      selection: part(2, 1),
      seen: 4,
    });
  });
});

describe('pickedSlot', () => {
  it('picks the part of a part or region selection, and nothing for an event or none', () => {
    expect(pickedSlot(part(3, 0))).toBe(3);
    expect(pickedSlot(part(3, null))).toBe(3);
    expect(pickedSlot(event)).toBeNull();
    expect(pickedSlot(null)).toBeNull();
  });
});
