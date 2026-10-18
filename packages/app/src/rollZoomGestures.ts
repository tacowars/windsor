/**
 * The Roll's zoom gestures, without the DOM (windsor#903; record
 * `2026-10-18-roll-zoom-bars-and-duplicate` decisions 4 to 6): the ruler's
 * drag, the keys' drag, the pinch and the Ctrl or ⌘ wheel. A drag and a
 * pinch work from what they captured at the press (the view drawn then, and
 * its bounds), never from a zoom an earlier move changed before the repaint
 * caught up, so any number of moves between two paints land where the last
 * one says.
 *
 * The ruler's drag is the Song tab's (`songZoomModel.ts`'s `stepRulerDrag`,
 * with `dragZoom`'s maths and its end rules) on the roll's bounds: px per
 * beat for px per bar, the region's beats for the song's bars, the region's
 * fit for the floor and `ROLL_TIME_ZOOM.maxBeatPx` for the ceiling. Up zooms
 * in, down out, around the pressed tick, and sideways carries the view with
 * the pointer. The keys' drag is the same drag turned a quarter: sideways
 * sets the row height (right taller) and along the keys carries the rows
 * with the pointer, around the pressed row. Both start past the Song tab's
 * threshold (`SONG_DRAG_THRESHOLD_PX`, `stepRulerDrag`'s default).
 */
import { PPQ } from '@windsor/engine';
import { ROLL_ROW_ZOOM, ROLL_TIME_ZOOM, ROLL_ZOOM_GESTURE } from './rollTables';
import { type RowLayout, relaidY, rowsHeightAt } from './rollRows';
import {
  type RowBounds,
  type RowView,
  type TimeBounds,
  type TimeView,
  regionFitPx,
  zoomRowsAbout,
  zoomTimeAbout,
} from './rollZoomModel';
import { SONG_VIEW } from './songViewTables';
import { type RulerDrag, type RulerDragEvent, stepRulerDrag } from './songZoomModel';

type GestureTable = typeof ROLL_ZOOM_GESTURE;

/** A point in the notes pane, px from its left and top edges. */
export interface PanePoint {
  readonly x: number;
  readonly y: number;
}

/** A press: its pointer, where it is on screen, and where it is in the notes pane. */
export interface ZoomPress {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly at: PanePoint;
}

/** A drag after one event: the drag (null once it ended), the view a move gave, and whether a release in place ended it. */
export interface ZoomStep<View, Drag = RulerDrag> {
  readonly drag: Drag | null;
  readonly view: View | null;
  readonly tap: boolean;
}

/** The ruler's drag from `press`, over the time view at the press and its bounds. */
export function rulerDrag(
  press: ZoomPress,
  view: TimeView,
  bounds: TimeBounds,
  table: typeof ROLL_TIME_ZOOM = ROLL_TIME_ZOOM,
): RulerDrag {
  const scrollPx = (view.left * view.beatPx) / PPQ;
  return {
    pointerId: press.pointerId,
    originX: press.clientX,
    originY: press.clientY,
    start: { pxPerBar: view.beatPx, scrollPx, pointerPx: scrollPx + press.at.x },
    bounds: { bars: bounds.regionTicks / PPQ, viewportPx: bounds.widthPx, chromePx: 0 },
    scale: {
      minPxPerBar: regionFitPx(bounds, table),
      maxPxPerBar: table.maxBeatPx,
      dragPxPerDoubling: SONG_VIEW.dragPxPerDoubling,
    },
    moved: false,
  };
}

/** One event of the ruler's drag. */
export function stepRuler(drag: RulerDrag | null, event: RulerDragEvent): ZoomStep<TimeView> {
  const step = stepRulerDrag(drag, event);
  const zoom = step.view;
  const view = zoom && { beatPx: zoom.pxPerBar, left: (zoom.scrollPx * PPQ) / zoom.pxPerBar };
  return { drag: step.drag, view, tap: step.clickPx !== null };
}

/**
 * The keys' drag: the ruler's drag turned a quarter for its events and its
 * row height, and the rows drawn at the press for where the pressed row
 * sits at each height.
 */
export interface KeysDrag {
  readonly pointerId: number;
  readonly ruler: RulerDrag;
  readonly rows: RowLayout;
  readonly heightPx: number;
}

/** The keys' drag from `press`, over the rows view at the press and the rows drawn in a pane `heightPx` tall. */
export function keysDrag(
  press: ZoomPress,
  view: RowView,
  drawn: { readonly rows: RowLayout; readonly heightPx: number },
  table: typeof ROLL_ROW_ZOOM = ROLL_ROW_ZOOM,
): KeysDrag {
  const ruler: RulerDrag = {
    pointerId: press.pointerId,
    originX: press.clientY,
    originY: -press.clientX,
    start: { pxPerBar: view.rowPx, scrollPx: view.top, pointerPx: view.top + press.at.y },
    // Only its row height is read: `stepKeys` places the rows from the layout.
    bounds: { bars: 0, viewportPx: drawn.heightPx, chromePx: 0 },
    scale: {
      minPxPerBar: table.minPx,
      maxPxPerBar: table.maxPx,
      dragPxPerDoubling: SONG_VIEW.dragPxPerDoubling,
    },
    moved: false,
  };
  return { pointerId: press.pointerId, ruler, rows: drawn.rows, heightPx: drawn.heightPx };
}

/** A move turned a quarter, as `keysDrag` reads it: down the keys is along, left is up. */
const turned = (event: RulerDragEvent): RulerDragEvent =>
  event.type === 'move' ? { ...event, clientX: event.clientY, clientY: -event.clientX } : event;

/**
 * One event of the keys' drag; a release in place is a tap, which does what
 * a tap on a key does. The pressed point stays under the pointer: laid out
 * again at the new row height by `rollRows`'s own maths (thin slivers and
 * Fold's filled rows keep their height), less the press's place in the
 * pane, less how far the pointer moved along the keys.
 */
export function stepKeys(
  drag: KeysDrag | null,
  event: RulerDragEvent,
): ZoomStep<RowView, KeysDrag> {
  const step = stepRulerDrag(drag && drag.ruler, turned(event));
  const next = drag && step.drag && { ...drag, ruler: step.drag };
  const tap = step.clickPx !== null;
  if (!drag || !step.view || event.type !== 'move') return { drag: next, view: null, tap };
  const { start, originX } = drag.ruler;
  const rowPx = step.view.pxPerBar;
  const at = relaidY(drag.rows, { y: start.pointerPx, from: start.pxPerBar, to: rowPx });
  // The pressed point's px under the pane's top, carried by the move along the keys.
  const under = start.pointerPx - start.scrollPx + (event.clientY - originX);
  const room = Math.max(0, rowsHeightAt(drag.rows, rowPx) - drag.heightPx);
  return { drag: next, view: { rowPx, top: Math.min(room, Math.max(0, at - under)) }, tap };
}

/** One axis of a pinch: the spread its zoom counts from (null until the fingers were apart enough), and the zoom. */
export interface PinchAxis {
  readonly from: number | null;
  readonly factor: number;
}

/**
 * The pinch's axis rule: an axis zooms only once the fingers are at least
 * `minPx` apart on it, from the spread they had then; a spread that closes
 * under `minPx` after counts as `minPx`, so two fingers in line never
 * divide by a sliver.
 */
export function pinchAxis(
  from: number | null,
  spread: number,
  table: GestureTable = ROLL_ZOOM_GESTURE,
): PinchAxis {
  if (from === null) return { from: spread >= table.pinchMinPx ? spread : null, factor: 1 };
  return { from, factor: Math.max(spread, table.pinchMinPx) / from };
}

/** What a pinch works from: the fingers' midpoint and the views at its start, and each axis's spread. */
export interface Pinch {
  readonly mid: PanePoint;
  readonly time: TimeView;
  readonly rows: RowView;
  readonly timeBounds: TimeBounds;
  readonly rowBounds: RowBounds;
  readonly fromX: number | null;
  readonly fromY: number | null;
}

/** The views a pinch starts from, and their bounds. */
export type PinchViews = Pick<Pinch, 'time' | 'rows' | 'timeBounds' | 'rowBounds'>;

const midpoint = (a: PanePoint, b: PanePoint): PanePoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** A pinch of fingers at `a` and `b` over `views`. */
export function startPinch(
  fingers: readonly [PanePoint, PanePoint],
  views: PinchViews,
  table: GestureTable = ROLL_ZOOM_GESTURE,
): Pinch {
  const [a, b] = fingers;
  const fromX = pinchAxis(null, Math.abs(a.x - b.x), table).from;
  const fromY = pinchAxis(null, Math.abs(a.y - b.y), table).from;
  return { ...views, mid: midpoint(a, b), fromX, fromY };
}

/** A pinch's views with its fingers at `a` and `b`, and which axes zoom. */
export interface PinchStep {
  readonly pinch: Pinch;
  readonly time: TimeView;
  readonly rows: RowView;
  readonly zooms: { readonly time: boolean; readonly rows: boolean };
}

/**
 * The views with the fingers at `a` and `b`: the horizontal spread zooms
 * time and the vertical spread the rows, each by its axis rule, and the
 * tick and the row under the starting midpoint follow the midpoint.
 */
export function stepPinch(
  pinch: Pinch,
  fingers: readonly [PanePoint, PanePoint],
  table: GestureTable = ROLL_ZOOM_GESTURE,
): PinchStep {
  const [a, b] = fingers;
  const x = pinchAxis(pinch.fromX, Math.abs(a.x - b.x), table);
  const y = pinchAxis(pinch.fromY, Math.abs(a.y - b.y), table);
  const mid = midpoint(a, b);
  const time = zoomTimeAbout(pinch.time, pinch.timeBounds, {
    factor: x.factor,
    x: pinch.mid.x,
    to: mid.x,
  });
  const rows = zoomRowsAbout(pinch.rows, pinch.rowBounds, {
    factor: y.factor,
    y: pinch.mid.y,
    to: mid.y,
  });
  const zooms = { time: x.from !== null, rows: y.from !== null };
  return { pinch: { ...pinch, fromX: x.from, fromY: y.from }, time, rows, zooms };
}

/**
 * The time zoom one Ctrl or ⌘ wheel event asks for (a trackpad's pinch
 * arrives this way): e for every `wheelPxPerE` px of wheel up, at most
 * `wheelMaxPx` an event, a line counting `wheelLinePx` and a page
 * `wheelPagePx`.
 */
export function wheelFactor(
  wheel: { readonly deltaY: number; readonly deltaMode: number },
  table: GestureTable = ROLL_ZOOM_GESTURE,
): number {
  const unit =
    wheel.deltaMode === 1 ? table.wheelLinePx : wheel.deltaMode === 2 ? table.wheelPagePx : 1;
  const px = Math.max(-table.wheelMaxPx, Math.min(table.wheelMaxPx, wheel.deltaY * unit));
  return Math.exp(-px / table.wheelPxPerE);
}
