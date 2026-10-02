import { describe, expect, it } from 'vitest';
import { adoptPartsPick, keepPartSelected, pickedSlot } from './partSelectionSync';
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

describe('keepPartSelected', () => {
  it('follows the Parts tab when an undo removes the part the Song view adopted', () => {
    // Parts adds slot 3 (a pick), the Song view adopts it, then Parts undoes the add
    // and falls back to slot 0 without a pick.
    const adopted = adoptPartsPick(part(0, 0), { slot: 3, picks: 1 }, 0);
    const back = adoptPartsPick(adopted.selection, { slot: 0, picks: 1 }, adopted.seen);
    expect(keepPartSelected(back.selection, 0, [0, 1])).toEqual(part(0, null));
  });

  it('falls back to the first part when the Parts slot is gone too, or to none', () => {
    expect(keepPartSelected(part(3, 0), 3, [1, 2])).toEqual(part(1, null));
    expect(keepPartSelected(part(3, 0), 3, [])).toBeNull();
  });

  it('keeps a selection whose part remains, an event, or none', () => {
    for (const selection of [null, event, part(1, 0)]) {
      expect(keepPartSelected(selection, 0, [0, 1])).toBe(selection);
    }
  });
});
