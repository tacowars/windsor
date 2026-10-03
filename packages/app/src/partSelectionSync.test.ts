import { describe, expect, it } from 'vitest';
import { pickedSlot, resolveSlot, syncSongSelection } from './partSelectionSync';
import type { SongSelection } from './songTab';

const part = (slot: number, region: number | null): SongSelection => ({
  kind: 'part',
  slot,
  region,
});
const event: SongSelection = { kind: 'event', index: 2 };
const slots = [0, 1, 2, 4];

describe('resolveSlot', () => {
  it('keeps a slot the song has, else takes the first part, else 0', () => {
    expect(resolveSlot([1, 3], 3)).toBe(3);
    expect(resolveSlot([1, 3], 0)).toBe(1);
    expect(resolveSlot([], 2)).toBe(0);
  });
});

describe('syncSongSelection', () => {
  it('selects a newly picked part, over an event, none or another part', () => {
    for (const selection of [null, event, part(4, 1)]) {
      expect(syncSongSelection(selection, { slot: 2, picks: 4 }, 3, slots)).toEqual({
        selection: part(2, null),
        seen: 4,
      });
    }
  });

  it('keeps the region while the part is the shared one', () => {
    expect(syncSongSelection(part(2, 1), { slot: 2, picks: 4 }, 3, slots).selection).toEqual(
      part(2, 1),
    );
  });

  it('moves to the shared slot when a song switch resets it without a pick', () => {
    // Song selects slot 1; the new song also has slot 1, but the reset put Parts on 0.
    expect(syncSongSelection(part(1, 1), { slot: 0, picks: 3 }, 3, slots)).toEqual({
      selection: part(0, null),
      seen: 3,
    });
  });

  it('keeps an event or none across a reset with no pick', () => {
    for (const selection of [null, event]) {
      expect(syncSongSelection(selection, { slot: 0, picks: 3 }, 3, slots).selection).toBe(
        selection,
      );
    }
  });

  it('follows the Parts tab when an undo removes the part the Song view adopted', () => {
    // Parts adds slot 3 (a pick), the Song view adopts it, then the undo falls back to 0.
    const adopted = syncSongSelection(part(0, 0), { slot: 3, picks: 1 }, 0, [0, 1, 3]);
    expect(adopted.selection).toEqual(part(3, null));
    const back = syncSongSelection(adopted.selection, { slot: 0, picks: 1 }, adopted.seen, [0, 1]);
    expect(back.selection).toEqual(part(0, null));
  });

  it('falls back to the first part when the shared slot is gone, or to none', () => {
    expect(syncSongSelection(part(3, 0), { slot: 3, picks: 1 }, 1, [1, 2]).selection).toEqual(
      part(1, null),
    );
    expect(syncSongSelection(part(3, 0), { slot: 3, picks: 1 }, 1, []).selection).toBeNull();
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
