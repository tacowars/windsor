import { describe, expect, it } from 'vitest';
import { menuTarget } from './patchMenuKeys';

// A document patch's ⋯ menu with Delete disabled (a song-only patch):
// Rename…, Revert, Delete, Library folder…, Patch JSON.
const MENU = [true, true, false, true, true];

describe('the ⋯ menu’s arrow keys', () => {
  it('moves down and up over the enabled items, skipping a disabled one', () => {
    expect(menuTarget(MENU, 0, 'ArrowDown')).toBe(1);
    expect(menuTarget(MENU, 1, 'ArrowDown')).toBe(3);
    expect(menuTarget(MENU, 3, 'ArrowUp')).toBe(1);
  });
  it('wraps at both ends', () => {
    expect(menuTarget(MENU, 4, 'ArrowDown')).toBe(0);
    expect(menuTarget(MENU, 0, 'ArrowUp')).toBe(4);
    expect(menuTarget([false, true, true, false], 2, 'ArrowDown')).toBe(1);
  });
  it('goes to the first and last enabled item on Home and End', () => {
    expect(menuTarget([false, true, true, false], 2, 'Home')).toBe(1);
    expect(menuTarget([false, true, true, false], 1, 'End')).toBe(2);
  });
  it('enters the list from outside it at the near end', () => {
    expect(menuTarget(MENU, -1, 'ArrowDown')).toBe(0);
    expect(menuTarget(MENU, -1, 'ArrowUp')).toBe(4);
  });
  it('answers null for another key, an empty list or nothing enabled', () => {
    expect(menuTarget(MENU, 0, 'Tab')).toBeNull();
    expect(menuTarget([], -1, 'ArrowDown')).toBeNull();
    expect(menuTarget([false, false], 0, 'End')).toBeNull();
  });
});
