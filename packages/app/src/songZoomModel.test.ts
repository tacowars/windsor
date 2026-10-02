/**
 * The ruler drag's zoom and scroll (windsor#8): the anchored bar stays under
 * the pointer, the scroll clamps at the first and last bar, the scale at the
 * table's bounds, for a 1-bar song and a `BARS_MAX` song alike.
 */
import { describe, expect, it } from 'vitest';

import { BARS_MAX } from '@windsor/engine';
import {
  clampScroll,
  clampZoom,
  dragZoom,
  fitPxPerBar,
  fittedScale,
  followFit,
  maxScroll,
  stepRulerDrag,
  clickedBar,
  zoomForDrag,
  zoomToFit,
} from './songZoomModel';
import type { RulerDrag, RulerDragEvent, ZoomBounds, ZoomDragStart } from './songZoomModel';
import { SONG_DRAG_THRESHOLD_PX, SONG_VIEW } from './songViewTables';

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

describe('the fit (windsor#21)', () => {
  const lanesPx = VIEWPORT - CHROME;

  it('fits a 1-bar, a 4-bar and a BARS_MAX song, the floor winning under it', () => {
    for (const bars of [1, 4, BARS_MAX]) {
      const b = bounds(bars);
      const fit = fitPxPerBar(b);
      expect(fit).toBeCloseTo(lanesPx / bars);
      const scale = fittedScale(b);
      expect(scale.minPxPerBar).toBe(Math.max(SONG_VIEW.minPxPerBar, lanesPx / bars));
      expect(scale.maxPxPerBar).toBeGreaterThanOrEqual(scale.minPxPerBar);
      // At the floor the last bar ends at the right edge, or the view scrolls when the table's floor won.
      const atFloor = maxScroll(b, scale.minPxPerBar);
      if (scale.minPxPerBar === lanesPx / bars) expect(atFloor).toBeCloseTo(0);
      else expect(atFloor).toBeGreaterThan(0);
    }
    expect(fittedScale(bounds(BARS_MAX)).minPxPerBar).toBe(SONG_VIEW.minPxPerBar);
    // A 1-bar song fills a window wider than the ceiling: the ceiling rises with it.
    expect(fittedScale(bounds(1)).maxPxPerBar).toBe(Math.max(SONG_VIEW.maxPxPerBar, lanesPx));
  });

  it('stops a drag down at the fit', () => {
    const b = bounds(4);
    const start: ZoomDragStart = { pxPerBar: 400, scrollPx: 300, pointerPx: 500 };
    const out = dragZoom(start, { dx: 0, dy: 1e4 }, b, fittedScale(b));
    expect(out.pxPerBar).toBeCloseTo(lanesPx / 4);
    expect(out.scrollPx).toBe(0);
  });

  it('has no fit before the view has a width', () => {
    expect(fitPxPerBar({ bars: 4, viewportPx: 0, chromePx: CHROME })).toBeNull();
    expect(fittedScale({ bars: 4, viewportPx: 0, chromePx: CHROME })).toBe(SONG_VIEW);
  });

  it('double-click returns to the fit at bar 1', () => {
    expect(zoomToFit(bounds(4))).toEqual({ pxPerBar: lanesPx / 4, scrollPx: 0 });
    expect(zoomToFit(bounds(BARS_MAX))).toEqual({ pxPerBar: SONG_VIEW.minPxPerBar, scrollPx: 0 });
  });

  it('follows the fit when a view at it narrows or widens, and clamps any other view up', () => {
    const wide = fittedScale({ bars: 8, viewportPx: 1600, chromePx: CHROME });
    const narrow = fittedScale({ bars: 8, viewportPx: 800, chromePx: CHROME });
    expect(followFit(wide.minPxPerBar, wide.minPxPerBar, narrow)).toBe(narrow.minPxPerBar);
    expect(followFit(narrow.minPxPerBar, narrow.minPxPerBar, wide)).toBe(wide.minPxPerBar);
    // Zoomed in: a narrower window keeps the zoom, a wider fit above it pulls it up.
    expect(followFit(400, wide.minPxPerBar, narrow)).toBe(400);
    expect(followFit(100, narrow.minPxPerBar, wide)).toBe(wide.minPxPerBar);
    // First measure: no previous floor, so a short song's fit pulls the default zoom up.
    expect(followFit(SONG_VIEW.pxPerBar, null, fittedScale(bounds(2)))).toBe(lanesPx / 2);
  });
});

describe('the ruler drag (a missed release never leaves a hover zooming)', () => {
  const b = bounds(64);
  const pressed: RulerDrag = {
    pointerId: 1,
    originX: 500,
    originY: 40,
    start: { pxPerBar: 96, scrollPx: 2000, pointerPx: 24.5 * 96 },
    bounds: b,
    scale: SONG_VIEW,
    moved: false,
  };
  const move = (dx: number, dy: number, buttons = 1, pointerId = 1): RulerDragEvent => ({
    type: 'move',
    pointerId,
    buttons,
    clientX: pressed.originX + dx,
    clientY: pressed.originY + dy,
  });
  const dragging = stepRulerDrag(pressed, move(0, -60)).drag as RulerDrag;

  it('zooms only while the pressing pointer holds the primary button past the threshold', () => {
    expect(stepRulerDrag(pressed, move(1, 1))).toEqual({
      drag: pressed,
      view: null,
      clickPx: null,
    });
    const step = stepRulerDrag(pressed, move(0, -60));
    expect(step.drag?.moved).toBe(true);
    expect(step.view).toEqual(dragZoom(pressed.start, { dx: 0, dy: -60 }, b));
    expect(stepRulerDrag(dragging, move(-80, 0, 1, 2))).toEqual({
      drag: dragging,
      view: null,
      clickPx: null,
    });
  });

  it('ends on a move with the button up, a release, a cancel, a lost capture or a blur, with no view change', () => {
    const endings: RulerDragEvent[] = [
      move(-300, 200, 0),
      move(-300, 200, 2),
      { type: 'up', pointerId: 1 },
      { type: 'cancel', pointerId: 1 },
      { type: 'lost', pointerId: 1 },
      { type: 'blur' },
    ];
    for (const event of endings) {
      for (const drag of [pressed, dragging]) {
        if (event.type === 'up' && !drag.moved) continue;
        expect(stepRulerDrag(drag, event)).toEqual({ drag: null, view: null, clickPx: null });
      }
    }
  });

  it('reads a release without moving as a click at the pressed px, never after a drag or a cancel', () => {
    const up: RulerDragEvent = { type: 'up', pointerId: 1 };
    expect(stepRulerDrag(pressed, up)).toEqual({
      drag: null,
      view: null,
      clickPx: pressed.start.pointerPx,
    });
    expect(stepRulerDrag(dragging, up).clickPx).toBeNull();
    expect(stepRulerDrag(pressed, { type: 'cancel', pointerId: 1 }).clickPx).toBeNull();
  });

  it('never changes the view on a hover with no drag live, button held or not', () => {
    for (const event of [move(0, -600), move(400, 0, 0), move(SONG_DRAG_THRESHOLD_PX * 10, 0)]) {
      expect(stepRulerDrag(null, event)).toEqual({ drag: null, view: null, clickPx: null });
    }
    // The double-click after two still presses: each release ended its press, so nothing is left live.
    let drag: RulerDrag | null = pressed;
    for (const event of [move(1, 0), { type: 'up', pointerId: 1 } as const]) {
      drag = stepRulerDrag(drag, event).drag;
    }
    expect(drag).toBeNull();
    expect(stepRulerDrag(drag, move(0, 300)).view).toBeNull();
  });
});

describe('clickedBar', () => {
  it('is the bar the pointer is inside, not the nearest line, clamped to the song', () => {
    expect(clickedBar(0, 100, 8)).toBe(0);
    expect(clickedBar(499, 100, 8)).toBe(4);
    expect(clickedBar(599, 100, 8)).toBe(5);
    expect(clickedBar(-30, 100, 8)).toBe(0);
    expect(clickedBar(5000, 100, 8)).toBe(7);
    expect(clickedBar(Number.NaN, 100, 8)).toBe(0);
    expect(clickedBar(50, 0, 8)).toBe(0);
    expect(clickedBar(50, 100, 0)).toBe(0);
  });
});
