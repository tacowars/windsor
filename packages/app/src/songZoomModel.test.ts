/**
 * The ruler drag's zoom and scroll (windsor#8): the anchored bar stays under
 * the pointer, the scroll clamps at the first and last bar, the scale at the
 * table's bounds, for a 1-bar song and a `BARS_MAX` song alike.
 */
import { describe, expect, it } from 'vitest';

import { BARS_MAX } from '@windsor/engine';
import { clampScroll, clampZoom, dragZoom, maxScroll, zoomForDrag } from './songZoomModel';
import type { ZoomBounds, ZoomDragStart } from './songZoomModel';
import { SONG_VIEW } from './songViewTables';

const CHROME = 156;
const VIEWPORT = 1000;
const bounds = (bars: number): ZoomBounds => ({ bars, viewportPx: VIEWPORT, chromePx: CHROME });

/** Where the anchored bar sits on screen, relative to the scroll container's left edge. */
const screenPx = (bar: number, pxPerBar: number, scrollPx: number): number =>
  bar * pxPerBar - scrollPx;

describe('the zoom', () => {
  it('doubles for a drag up of one doubling and halves for one down', () => {
    const per = SONG_VIEW.dragPxPerDoubling;
    expect(zoomForDrag(96, -per)).toBeCloseTo(192);
    expect(zoomForDrag(96, per)).toBeCloseTo(48);
    expect(zoomForDrag(96, 0)).toBe(96);
  });

  it('clamps at both table bounds', () => {
    expect(clampZoom(1)).toBe(SONG_VIEW.minPxPerBar);
    expect(clampZoom(1e6)).toBe(SONG_VIEW.maxPxPerBar);
    expect(zoomForDrag(96, 100 * SONG_VIEW.dragPxPerDoubling)).toBe(SONG_VIEW.minPxPerBar);
    expect(zoomForDrag(96, -100 * SONG_VIEW.dragPxPerDoubling)).toBe(SONG_VIEW.maxPxPerBar);
    expect(SONG_VIEW.minPxPerBar).toBeLessThan(SONG_VIEW.pxPerBar);
    expect(SONG_VIEW.maxPxPerBar).toBeGreaterThan(SONG_VIEW.pxPerBar);
  });
});

describe('the anchored drag', () => {
  const start: ZoomDragStart = { pxPerBar: 96, scrollPx: 2000, pointerPx: 24.5 * 96 };
  const anchor = start.pointerPx / start.pxPerBar;
  const before = screenPx(anchor, start.pxPerBar, start.scrollPx);

  it('keeps the bar under the press under the pointer as it zooms in and out', () => {
    for (const dy of [-90, -30, 25, 60]) {
      const view = dragZoom(start, { dx: 0, dy }, bounds(64));
      expect(view.pxPerBar).not.toBe(start.pxPerBar);
      expect(screenPx(anchor, view.pxPerBar, view.scrollPx)).toBeCloseTo(before);
    }
  });

  it('drags the arrangement with the pointer, both axes in one drag', () => {
    const view = dragZoom(start, { dx: -120, dy: -40 }, bounds(64));
    expect(screenPx(anchor, view.pxPerBar, view.scrollPx)).toBeCloseTo(before - 120);
    const pan = dragZoom(start, { dx: 200, dy: 0 }, bounds(64));
    expect(pan).toEqual({ pxPerBar: 96, scrollPx: 1800 });
  });

  it('changes nothing without movement', () => {
    expect(dragZoom(start, { dx: 0, dy: 0 }, bounds(64))).toEqual({
      pxPerBar: start.pxPerBar,
      scrollPx: start.scrollPx,
    });
  });
});

describe('the scroll', () => {
  it('clamps at the first bar and at the last', () => {
    const b = bounds(64);
    expect(clampScroll(-50, b, 96)).toBe(0);
    expect(maxScroll(b, 96)).toBe(CHROME + 64 * 96 - VIEWPORT);
    expect(clampScroll(1e9, b, 96)).toBe(maxScroll(b, 96));
    const start: ZoomDragStart = { pxPerBar: 96, scrollPx: 0, pointerPx: 48 };
    expect(dragZoom(start, { dx: 300, dy: 0 }, b).scrollPx).toBe(0);
    expect(dragZoom(start, { dx: -1e6, dy: 0 }, b).scrollPx).toBe(maxScroll(b, 96));
  });

  it('never scrolls a 1-bar song, at any zoom', () => {
    const start: ZoomDragStart = { pxPerBar: 96, scrollPx: 0, pointerPx: 48 };
    for (const dy of [-1000, -60, 0, 60, 1000]) {
      const view = dragZoom(start, { dx: -300, dy }, bounds(1));
      expect(view.pxPerBar).toBe(clampZoom(view.pxPerBar));
      expect(view.scrollPx).toBeLessThanOrEqual(maxScroll(bounds(1), view.pxPerBar));
    }
    expect(maxScroll(bounds(1), SONG_VIEW.pxPerBar)).toBe(0);
  });

  it('reaches the last bar of a BARS_MAX song, zoomed out to the floor and in to the ceiling', () => {
    const b = bounds(BARS_MAX);
    const start: ZoomDragStart = { pxPerBar: 96, scrollPx: 0, pointerPx: 200 * 96 };
    const out = dragZoom(start, { dx: 0, dy: 1e4 }, b);
    expect(out.pxPerBar).toBe(SONG_VIEW.minPxPerBar);
    expect(out.scrollPx).toBeGreaterThanOrEqual(0);
    expect(out.scrollPx).toBeLessThanOrEqual(maxScroll(b, out.pxPerBar));
    const deep = dragZoom(start, { dx: -1e9, dy: -1e4 }, b);
    expect(deep.pxPerBar).toBe(SONG_VIEW.maxPxPerBar);
    expect(deep.scrollPx).toBe(CHROME + BARS_MAX * SONG_VIEW.maxPxPerBar - VIEWPORT);
  });
});
