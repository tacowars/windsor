import { describe, expect, it } from 'vitest';
import type { Box, MenuRow, MenuSpec, ShownItem } from './contextMenuModel';
import {
  SEPARATOR,
  choose,
  itemUnder,
  menuMode,
  menuPlacement,
  menuSize,
  mousePlacement,
  movePreview,
  rowTag,
  shownItems,
  submenuPlacement,
  touchPlacement,
} from './contextMenuModel';

const row = (label: string, extra: Partial<MenuRow> = {}): MenuRow => ({
  kind: 'row',
  label,
  run: () => undefined,
  ...extra,
});

describe('the size the opening press picks', () => {
  it('is a finger’s for touch or pen and a mouse’s for anything else, a trackpad included', () => {
    expect(menuMode('touch')).toBe('touch');
    expect(menuMode('pen')).toBe('touch');
    expect(menuMode('mouse')).toBe('mouse');
    expect(menuMode('')).toBe('mouse');
  });

  it('is 32 px rows, 12 px labels and 220 px for a mouse; 44, 15 and 260 for a finger', () => {
    expect(menuSize('mouse')).toMatchObject({ rowPx: 32, labelPx: 12, minWidthPx: 220 });
    expect(menuSize('touch')).toMatchObject({ rowPx: 44, labelPx: 15, minWidthPx: 260 });
  });

  it('hides keyboard tags on touch and keeps reason tags', () => {
    const cut = row('Cut', { tag: '⌘X', kbd: true });
    const paste = row('Paste at bar 6', { tag: 'nothing copied', disabled: true });
    expect(rowTag(cut, menuSize('mouse'))).toBe('⌘X');
    expect(rowTag(cut, menuSize('touch'))).toBeNull();
    expect(rowTag(paste, menuSize('touch'))).toBe('nothing copied');
    expect(rowTag(row('Copy'), menuSize('mouse'))).toBeNull();
  });
});

describe('a mouse’s menu', () => {
  const menu = { width: 240, height: 400 };
  const viewport = { width: 1440, height: 900 };
  const inside = ({ top, left }: { top: number; left: number }): void => {
    expect(left).toBeGreaterThanOrEqual(8);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(left + menu.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(top + menu.height).toBeLessThanOrEqual(viewport.height - 8);
  };

  it('opens at the pointer', () => {
    const placed = mousePlacement({ x: 500, y: 300 }, menu, viewport);
    expect(placed).toMatchObject({ left: 502, top: 302 });
  });

  it('flips left of the pointer at the right edge and above it at the bottom', () => {
    expect(mousePlacement({ x: 1300, y: 300 }, menu, viewport).left).toBe(1300 - 2 - 240);
    expect(mousePlacement({ x: 500, y: 700 }, menu, viewport).top).toBe(700 - 2 - 400);
  });

  it('fits at all four corners of the window', () => {
    for (const x of [0, viewport.width])
      for (const y of [0, viewport.height]) inside(mousePlacement({ x, y }, menu, viewport));
  });
});

describe('a finger’s menu', () => {
  const menu = { width: 280, height: 640 };
  const landscape = { width: 1366, height: 1024 };
  const portrait = { width: 1024, height: 1366 };
  const lane = { top: 300, bottom: 340 };

  it('sits left of the finger, its right edge 32 px away, its top 4 px under the lane', () => {
    const placed = touchPlacement({ at: { x: 700, y: 320 }, lane, menu, viewport: landscape });
    expect(placed).toMatchObject({ left: 700 - 32 - 280, top: 344 });
  });

  it('flips right of the finger when the left has no room for it and the 8 px edge', () => {
    const at = (x: number) =>
      touchPlacement({ at: { x, y: 320 }, lane, menu, viewport: landscape });
    expect(at(32 + 280 + 8).left).toBe(8);
    expect(at(32 + 280 + 7).left).toBe(32 + 280 + 7 + 32);
  });

  it('slides up only as far as the bottom edge needs', () => {
    const low = { top: 640, bottom: 680 };
    const placed = touchPlacement({ at: { x: 700, y: 660 }, lane: low, menu, viewport: landscape });
    expect(placed.top).toBe(1024 - 8 - 640);
  });

  it('fits 8 px inside the screen in landscape and portrait, from every corner', () => {
    for (const viewport of [landscape, portrait])
      for (const x of [0, viewport.width])
        for (const y of [0, viewport.height]) {
          const at = { x, y };
          const { top, left } = touchPlacement({ at, lane: { top: y, bottom: y }, menu, viewport });
          expect(left).toBeGreaterThanOrEqual(8);
          expect(top).toBeGreaterThanOrEqual(8);
          expect(left + menu.width).toBeLessThanOrEqual(viewport.width - 8);
          expect(top + menu.height).toBeLessThanOrEqual(viewport.height - 8);
        }
  });

  it('is what the opening press picks, under the press itself when no lane is given', () => {
    const press = { x: 700, y: 320, pointerType: 'touch' };
    expect(menuPlacement({ ...press, lane }, menu, landscape).top).toBe(344);
    expect(menuPlacement(press, menu, landscape).top).toBe(324);
    expect(menuPlacement({ ...press, pointerType: 'mouse' }, menu, landscape).left).toBe(702);
  });
});

describe('a mouse’s submenu', () => {
  const menu = { width: 160, height: 260 };
  const viewport = { width: 1440, height: 900 };
  const parent = { left: 500, right: 740, top: 100, bottom: 500 };

  it('opens beside its row, overlapping the menu a little', () => {
    const placed = submenuPlacement({ parent, row: { top: 300, bottom: 332 }, menu, viewport });
    expect(placed).toMatchObject({ left: 736, top: 295 });
  });

  it('flips left of the menu near the right edge', () => {
    const right = { left: 1180, right: 1420, top: 100, bottom: 500 };
    const placed = submenuPlacement({
      parent: right,
      row: { top: 300, bottom: 332 },
      menu,
      viewport,
    });
    expect(placed.left).toBe(1180 - 160 + 4);
  });
});

describe('drilling into a submenu by touch', () => {
  const grid = row('Grid');
  const spec: MenuSpec = {
    head: 'pad · bars 1–16',
    items: [row('Cut'), SEPARATOR, { kind: 'submenu', label: 'Set sequencer', items: [grid] }],
  };

  it('swaps the rows for a back row and the submenu’s, and the back row returns to the parent', () => {
    expect(shownItems(spec, [])).toBe(spec.items);
    const choice = choose(shownItems(spec, []), 2);
    expect(choice).toMatchObject({ kind: 'open', index: 2 });
    const drilled = shownItems(spec, [2]);
    expect(drilled).toEqual([{ kind: 'back', label: 'Set sequencer' }, SEPARATOR, grid]);
    expect(choose(drilled, 0)).toEqual({ kind: 'back' });
    expect(shownItems(spec, [2].slice(0, -1))).toBe(spec.items);
  });
});

describe('choosing a row', () => {
  const ok = row('Copy');
  const off = row('Paste at bar 6', { tag: 'nothing copied', disabled: true });
  const items: ShownItem[] = [ok, SEPARATOR, off];

  it('runs an enabled row, and never a disabled row, a separator or no row', () => {
    expect(choose(items, 0)).toEqual({ kind: 'run', row: ok });
    expect(choose(items, 1)).toEqual({ kind: 'none' });
    expect(choose(items, 2)).toEqual({ kind: 'none' });
    expect(choose(items, null)).toEqual({ kind: 'none' });
  });
});

describe('the preview', () => {
  const ok = row('Loop region');
  const other = row('Split here');
  const off = row('Paste at bar 6', { disabled: true });

  it('moves to an enabled row, unpreviewing the last one first', () => {
    expect(movePreview(null, ok)).toEqual({ previewed: ok, unpreview: null, preview: ok });
    expect(movePreview(ok, other)).toEqual({ previewed: other, unpreview: ok, preview: other });
    expect(movePreview(ok, ok)).toEqual({ previewed: ok, unpreview: null, preview: null });
    expect(movePreview(ok, undefined)).toEqual({ previewed: null, unpreview: ok, preview: null });
  });

  it('never previews a disabled row, a separator or a submenu', () => {
    expect(movePreview(null, off).preview).toBeNull();
    expect(movePreview(ok, off)).toEqual({ previewed: null, unpreview: ok, preview: null });
    expect(movePreview(null, SEPARATOR).preview).toBeNull();
    expect(movePreview(null, { kind: 'submenu', label: 'Set sequencer', items: [] }).preview).toBe(
      null,
    );
  });
});

describe('slide-to-choose', () => {
  const calls: string[] = [];
  const watched = (label: string, disabled = false): MenuRow =>
    row(label, {
      disabled,
      run: () => calls.push(`run ${label}`),
      preview: () => calls.push(`preview ${label}`),
      unpreview: () => calls.push(`unpreview ${label}`),
    });
  const items: ShownItem[] = [watched('Zoom to region'), SEPARATOR, watched('Paste', true)];
  const box = (top: number): Box => ({ left: 100, right: 380, top, bottom: top + 44 });
  const boxes = [box(50), null, box(100)];

  /** The finger at each point in turn, then lifted at the last: the calls the menu makes. */
  function slide(path: readonly { x: number; y: number }[]): string[] {
    calls.length = 0;
    let previewed: MenuRow | null = null;
    for (const at of path) {
      const index = itemUnder(boxes, at);
      const move = movePreview(previewed, index === null ? undefined : items[index]);
      previewed = move.previewed;
      move.unpreview?.unpreview?.();
      move.preview?.preview?.();
    }
    previewed?.unpreview?.();
    const choice = choose(items, itemUnder(boxes, path[path.length - 1] ?? { x: 0, y: 0 }));
    if (choice.kind === 'run') choice.row.run();
    return [...calls];
  }

  it('previews the lit row and runs it on lift', () => {
    expect(
      slide([
        { x: 50, y: 70 },
        { x: 200, y: 70 },
      ]),
    ).toEqual(['preview Zoom to region', 'unpreview Zoom to region', 'run Zoom to region']);
  });

  it('runs nothing on a lift off every row, and a disabled row never previews or runs', () => {
    expect(
      slide([
        { x: 200, y: 70 },
        { x: 600, y: 70 },
      ]),
    ).toEqual(['preview Zoom to region', 'unpreview Zoom to region']);
    expect(slide([{ x: 200, y: 120 }])).toEqual([]);
  });

  it('finds no row in a separator’s gap or past the menu’s sides', () => {
    expect(itemUnder(boxes, { x: 200, y: 96 })).toBeNull();
    expect(itemUnder(boxes, { x: 380, y: 70 })).toBeNull();
    expect(itemUnder(boxes, { x: 100, y: 143 })).toBe(2);
  });
});
