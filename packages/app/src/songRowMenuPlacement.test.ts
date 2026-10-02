/**
 * The row menu's placement (windsor#434): under its ⋯ button when there is
 * room, above it near the bottom of the viewport, and never past an edge,
 * so Delete… stays reachable (a scroll closes the menu).
 */
import { describe, expect, it } from 'vitest';
import { SONG_MENU_EDGE_PX, SONG_MENU_GAP_PX } from './songListTables';
import { rowMenuPlacement } from './songRowMenuPlacement';

const menu = { width: 170, height: 190 };
const viewport = { width: 1400, height: 600 };
/** A 24 px tall ⋯ button whose right edge is at `right` and top at `top`. */
const opener = (top: number, right = 1300) => ({ top, bottom: top + 24, right });

describe('rowMenuPlacement', () => {
  it('opens under the button, right edges lined up, when there is room below', () => {
    expect(rowMenuPlacement({ opener: opener(100), menu, viewport })).toEqual({
      top: 124 + SONG_MENU_GAP_PX,
      left: 1300 - menu.width,
    });
  });

  it('flips above the button near the bottom of the viewport, so Delete… is on screen', () => {
    const { top } = rowMenuPlacement({ opener: opener(520), menu, viewport });
    expect(top).toBe(520 - SONG_MENU_GAP_PX - menu.height);
    expect(top + menu.height).toBeLessThanOrEqual(viewport.height - SONG_MENU_EDGE_PX);
  });

  it('keeps the menu inside the right edge when the button is near it', () => {
    const { left } = rowMenuPlacement({
      opener: opener(100, viewport.width + 40),
      menu,
      viewport,
    });
    expect(left).toBe(viewport.width - SONG_MENU_EDGE_PX - menu.width);
  });

  it('keeps the menu inside the left edge when it is wider than the room left of the button', () => {
    expect(rowMenuPlacement({ opener: opener(100, 60), menu, viewport }).left).toBe(
      SONG_MENU_EDGE_PX,
    );
  });

  it('clamps inside the viewport when it fits neither below nor above', () => {
    const short = { width: 1400, height: 260 };
    const { top } = rowMenuPlacement({ opener: opener(110), menu, viewport: short });
    expect(top).toBe(short.height - SONG_MENU_EDGE_PX - menu.height);
    expect(top).toBeGreaterThanOrEqual(SONG_MENU_EDGE_PX);
  });
});
