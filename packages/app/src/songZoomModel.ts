/**
 * The Song view's zoom and scroll (windsor#8), as pure maths over the ruler
 * drag: a press on the ruler records where it started, and every move after
 * it is a new scale and a new scroll offset. Vertical motion zooms — up in,
 * down out, `SONG_VIEW.dragPxPerDoubling` px per doubling — anchored at the
 * bar under the press, and horizontal motion drags the arrangement with the
 * pointer, so the anchored bar stays under the pointer through both axes.
 * The scale clamps to `SONG_VIEW`'s bounds and the scroll to the content,
 * the first bar at the left edge and the last at the right. View state only:
 * none of it reaches the document.
 *
 * The fit (windsor#21) is the zoom's real floor: `fittedScale` raises the
 * table's `minPxPerBar` to the scale at which every bar fills the visible
 * lanes width, and a view at the fit follows it when the window or the
 * song's length moves it (`followFit`).
 *
 * The drag itself is a small state machine (`stepRulerDrag`): only a move of
 * the pressing pointer with the primary button still down changes the view;
 * a release, a cancel, a lost capture, a window blur or a move with the
 * button up ends it, so a missed release can never leave a hover zooming.
 */
import type { SongViewScale } from './songViewTables';
import { FIT_TOLERANCE_PX, SONG_DRAG_THRESHOLD_PX, SONG_VIEW, primaryHeld } from './songViewTables';

/** Where a ruler drag started. */
export interface ZoomDragStart {
  /** The scale at the press. */
  readonly pxPerBar: number;
  /** The scroll container's `scrollLeft` at the press. */
  readonly scrollPx: number;
  /** The press's px from the ruler's first bar line: the anchored bar is `pointerPx / pxPerBar`. */
  readonly pointerPx: number;
}

/** The content the scroll clamps against. */
export interface ZoomBounds {
  readonly bars: number;
  /** The scroll container's visible width (`clientWidth`). */
  readonly viewportPx: number;
  /** The content's width besides the bars — padding, the name column, the gap: `scrollWidth - bars · pxPerBar`. */
  readonly chromePx: number;
}

export interface SongZoom {
  readonly pxPerBar: number;
  readonly scrollPx: number;
}

/** A scale inside the table's bounds. */
export function clampZoom(pxPerBar: number, scale: SongViewScale = SONG_VIEW): number {
  return Math.min(scale.maxPxPerBar, Math.max(scale.minPxPerBar, pxPerBar));
}

/** The furthest the view scrolls at `pxPerBar`: the last bar at the right edge, or 0 when the song fits. */
export function maxScroll(bounds: ZoomBounds, pxPerBar: number): number {
  return Math.max(0, bounds.chromePx + bounds.bars * pxPerBar - bounds.viewportPx);
}

/** A scroll offset inside the content. */
export function clampScroll(scrollPx: number, bounds: ZoomBounds, pxPerBar: number): number {
  return Math.min(maxScroll(bounds, pxPerBar), Math.max(0, scrollPx));
}

/** The scale after a vertical drag of `dy` px (screen y grows downward, so up is negative and zooms in). */
export function zoomForDrag(
  startPxPerBar: number,
  dy: number,
  scale: SongViewScale = SONG_VIEW,
): number {
  return clampZoom(startPxPerBar * 2 ** (-dy / scale.dragPxPerDoubling), scale);
}

/**
 * The view after the pointer moved `dx`, `dy` from the press: the new scale,
 * and the scroll that keeps the anchored bar under the pointer — it sat
 * `pointerPx` into the ruler and now sits `pointerPx · ratio`, and the
 * pointer moved `dx` — clamped to the content.
 */
export function dragZoom(
  start: ZoomDragStart,
  move: { readonly dx: number; readonly dy: number },
  bounds: ZoomBounds,
  scale: SongViewScale = SONG_VIEW,
): SongZoom {
  const pxPerBar = zoomForDrag(start.pxPerBar, move.dy, scale);
  const anchorShift = start.pointerPx * (pxPerBar / start.pxPerBar - 1);
  const scrollPx = clampScroll(start.scrollPx + anchorShift - move.dx, bounds, pxPerBar);
  return { pxPerBar, scrollPx };
}

/** The scale at which all `bars` fill the viewport besides the chrome: the last bar ends at the right edge. Null before the view has a width. */
export function fitPxPerBar(bounds: ZoomBounds): number | null {
  const lanesPx = bounds.viewportPx - bounds.chromePx;
  if (!(bounds.bars > 0) || !(lanesPx > 0)) return null;
  return lanesPx / bounds.bars;
}

/**
 * The table with its floor raised to the fit: `minPxPerBar` stays the
 * absolute floor under a fit smaller than it (the view scrolls), and the
 * ceiling rises with a fit above it (a short song in a wide window fills it).
 */
export function fittedScale(bounds: ZoomBounds, scale: SongViewScale = SONG_VIEW): SongViewScale {
  const fit = fitPxPerBar(bounds);
  if (fit === null) return scale;
  const minPxPerBar = Math.max(scale.minPxPerBar, fit);
  return { ...scale, minPxPerBar, maxPxPerBar: Math.max(scale.maxPxPerBar, minPxPerBar) };
}

/**
 * The zoom after the fit moved from `previousFloor` to `next`'s floor (a
 * resize, a Bars change): a view that sat at the old floor stays at the
 * new one, narrowing or widening, and any other view is clamped into
 * `next`, so a fit that rose past it pulls it up.
 */
export function followFit(
  pxPerBar: number,
  previousFloor: number | null,
  next: SongViewScale,
): number {
  const atFloor = previousFloor !== null && Math.abs(pxPerBar - previousFloor) <= FIT_TOLERANCE_PX;
  return atFloor ? next.minPxPerBar : clampZoom(pxPerBar, next);
}

/** A live ruler drag: the pressing pointer, where it pressed, and what the view clamps to. */
export interface RulerDrag {
  readonly pointerId: number;
  readonly originX: number;
  readonly originY: number;
  readonly start: ZoomDragStart;
  readonly bounds: ZoomBounds;
  readonly scale: SongViewScale;
  /** Past the threshold: a press that never gets here changes nothing. */
  readonly moved: boolean;
}

/** What reaches the drag: a pointer move, or one of the events that end it. */
export type RulerDragEvent =
  | {
      readonly type: 'move';
      readonly pointerId: number;
      readonly buttons: number;
      readonly clientX: number;
      readonly clientY: number;
    }
  | { readonly type: 'up' | 'cancel' | 'lost'; readonly pointerId: number }
  | { readonly type: 'blur' };

/** The drag after an event (null once it ended) and the view to apply, if the event moved it. */
export interface RulerDragStep {
  readonly drag: RulerDrag | null;
  readonly view: SongZoom | null;
}

/**
 * One event of the ruler drag. With no drag live nothing changes — a hover
 * never zooms or scrolls. Another pointer's events are ignored. A move
 * without the primary button, a release, a cancel, a lost capture or a
 * window blur ends the drag and leaves the view where the last move put it.
 * A move under the threshold waits; past it every move is a new view.
 */
export function stepRulerDrag(
  drag: RulerDrag | null,
  event: RulerDragEvent,
  thresholdPx: number = SONG_DRAG_THRESHOLD_PX,
): RulerDragStep {
  if (!drag || event.type === 'blur') return { drag: null, view: null };
  if (event.pointerId !== drag.pointerId) return { drag, view: null };
  if (event.type !== 'move' || !primaryHeld(event.buttons)) return { drag: null, view: null };
  const dx = event.clientX - drag.originX;
  const dy = event.clientY - drag.originY;
  if (!drag.moved && Math.max(Math.abs(dx), Math.abs(dy)) < thresholdPx) {
    return { drag, view: null };
  }
  return {
    drag: drag.moved ? drag : { ...drag, moved: true },
    view: dragZoom(drag.start, { dx, dy }, drag.bounds, drag.scale),
  };
}

/** A double-click on the ruler: the fit, from bar 1. */
export function zoomToFit(bounds: ZoomBounds, scale: SongViewScale = SONG_VIEW): SongZoom {
  return { pxPerBar: fittedScale(bounds, scale).minPxPerBar, scrollPx: 0 };
}
