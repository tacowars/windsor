/**
 * The Roll's zoom, without the DOM (windsor#902; record
 * `2026-10-18-roll-zoom-bars-and-duplicate` decisions 1, 3 and 8, the
 * approved mockup `docs/design/roll-zoom-mockup.html`, option B).
 *
 * Time: px per beat, from the whole region in the notes pane's width (the
 * floor) in to `ROLL_TIME_ZOOM.maxBeatPx`. Two fits: Region, the floor; and
 * Loop, the loop across the width less a small inset, within the same
 * bounds, so a half-bar loop on a wide pane stops at the ceiling. Whether a
 * view sits on a fit is read from the view itself (`fitsOf`), never from
 * the last button pressed. Rows: a row height in px, continuous between
 * `ROLL_ROW_ZOOM`'s bounds.
 *
 * The bars' maths is here too: a thumb never shorter than its least length
 * runs on a track that length shorter, so each end moves with the view's
 * own edge, and a grip stays under the finger however short the view
 * (`thumbOf`, `fracAt`).
 */
import { PPQ } from '@windsor/engine';
import { ROLL_FIT_TOLERANCE, ROLL_ROW_ZOOM, ROLL_TIME_ZOOM } from './rollTables';

/** The two spans a view can be fitted to. */
export type RollFit = 'loop' | 'region';

/** Which edge of a view: its start (left, top) or its end (right, bottom). */
export type ViewEdge = 'start' | 'end';

/** What bounds the time zoom: the notes pane's width, and the region and its loop in ticks. */
export interface TimeBounds {
  readonly widthPx: number;
  readonly regionTicks: number;
  readonly loopTicks: number;
}

/** A horizontal view: px per beat, and the tick at its left edge. */
export interface TimeView {
  readonly beatPx: number;
  readonly left: number;
}

type TimeTable = typeof ROLL_TIME_ZOOM;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The ticks a pane `widthPx` wide shows at `beatPx`. */
export const shownTicks = (widthPx: number, beatPx: number): number => (widthPx * PPQ) / beatPx;

/** The floor and Region's fit: the whole region across the width, never past the ceiling. */
export function regionFitPx(bounds: TimeBounds, table: TimeTable = ROLL_TIME_ZOOM): number {
  const beats = bounds.regionTicks / PPQ;
  if (!(beats > 0)) return table.maxBeatPx;
  return Math.min(table.maxBeatPx, Math.max(1, bounds.widthPx - table.fitInsetPx) / beats);
}

/** Loop's fit: the loop (never past the region) across the width, within the floor and ceiling. */
export function loopFitPx(bounds: TimeBounds, table: TimeTable = ROLL_TIME_ZOOM): number {
  const floor = regionFitPx(bounds, table);
  const beats = Math.min(bounds.loopTicks, bounds.regionTicks) / PPQ;
  if (!(beats > 0)) return floor;
  return clamp((bounds.widthPx - table.loopInsetPx) / beats, floor, table.maxBeatPx);
}

/** The px per beat `fit` draws at. */
export const fitPx = (
  fit: RollFit,
  bounds: TimeBounds,
  table: TimeTable = ROLL_TIME_ZOOM,
): number => (fit === 'loop' ? loopFitPx(bounds, table) : regionFitPx(bounds, table));

/** The view `fit` gives: its px per beat, from tick 0. */
export const fitView = (
  fit: RollFit,
  bounds: TimeBounds,
  table: TimeTable = ROLL_TIME_ZOOM,
): TimeView => ({ beatPx: fitPx(fit, bounds, table), left: 0 });

/** `view` within the floor and the ceiling, its left edge within the region. */
export function clampTime(
  view: TimeView,
  bounds: TimeBounds,
  table: TimeTable = ROLL_TIME_ZOOM,
): TimeView {
  const beatPx = clamp(view.beatPx, regionFitPx(bounds, table), table.maxBeatPx);
  const room = Math.max(0, bounds.regionTicks - shownTicks(bounds.widthPx, beatPx));
  return { beatPx, left: clamp(view.left, 0, room) };
}

/** Zoom by `factor`, keeping the tick `x` px from the left edge where it is. */
export function zoomTimeAbout(
  view: TimeView,
  bounds: TimeBounds,
  zoom: { factor: number; x: number },
  table: TimeTable = ROLL_TIME_ZOOM,
): TimeView {
  const tick = view.left + (zoom.x * PPQ) / view.beatPx;
  const beatPx = clamp(view.beatPx * zoom.factor, regionFitPx(bounds, table), table.maxBeatPx);
  return clampTime({ beatPx, left: tick - (zoom.x * PPQ) / beatPx }, bounds, table);
}

/**
 * The view from `start` to `end` ticks, as near as the bounds allow, with
 * the `hold` edge where it is: one edge moved, the other held.
 */
export function spanTime(
  bounds: TimeBounds,
  span: { start: number; end: number; hold: ViewEdge },
  table: TimeTable = ROLL_TIME_ZOOM,
): TimeView {
  const ticks = Math.max(1, span.end - span.start);
  const beatPx = clamp((bounds.widthPx * PPQ) / ticks, regionFitPx(bounds, table), table.maxBeatPx);
  const left = span.hold === 'start' ? span.start : span.end - shownTicks(bounds.widthPx, beatPx);
  return clampTime({ beatPx, left }, bounds, table);
}

/** Whether two px per beat are the same zoom. */
const sameZoom = (a: number, b: number, tolerance = ROLL_FIT_TOLERANCE): boolean =>
  Math.abs(a - b) <= tolerance.relative * Math.max(a, b);

/**
 * Which fits `view` sits on, read from the view itself: its zoom is the
 * fit's and it starts at tick 0. A loop as long as the region sits on both.
 */
export function fitsOf(
  view: TimeView,
  bounds: TimeBounds,
  table: TimeTable = ROLL_TIME_ZOOM,
): Record<RollFit, boolean> {
  const atStart = (view.left * view.beatPx) / PPQ <= ROLL_FIT_TOLERANCE.edgePx;
  return {
    loop: atStart && sameZoom(view.beatPx, loopFitPx(bounds, table)),
    region: atStart && sameZoom(view.beatPx, regionFitPx(bounds, table)),
  };
}

/**
 * The fit a view keeps after a change: the one it had while it still sits
 * on it, else the one it now sits on, Loop first; else none.
 */
export function settleFit(
  had: RollFit | null,
  view: TimeView,
  bounds: TimeBounds,
  table: TimeTable = ROLL_TIME_ZOOM,
): RollFit | null {
  const on = fitsOf(view, bounds, table);
  if (had && on[had]) return had;
  return on.loop ? 'loop' : on.region ? 'region' : null;
}

/**
 * What bounds the row zoom: the notes pane's height, and the rows' height
 * as `scaled` rows of the zoom's height plus `fixedPx` that never scale (a
 * thin sliver, a folded row the pane's fill holds taller).
 */
export interface RowBounds {
  readonly heightPx: number;
  readonly scaled: number;
  readonly fixedPx: number;
}

/** A vertical view: the row height, and the px of the rows above its top edge. */
export interface RowView {
  readonly rowPx: number;
  readonly top: number;
}

type RowTable = typeof ROLL_ROW_ZOOM;

/** The rows' whole height at `rowPx`. */
export const rowsHeight = (bounds: RowBounds, rowPx: number): number =>
  bounds.scaled * rowPx + bounds.fixedPx;

/** `view` within the row bounds, its top within the rows. */
export function clampRows(
  view: RowView,
  bounds: RowBounds,
  table: RowTable = ROLL_ROW_ZOOM,
): RowView {
  const rowPx = clamp(view.rowPx, table.minPx, table.maxPx);
  const room = Math.max(0, rowsHeight(bounds, rowPx) - bounds.heightPx);
  return { rowPx, top: clamp(view.top, 0, room) };
}

/** Zoom the rows by `factor`, keeping the row `y` px under the top edge where it is. */
export function zoomRowsAbout(
  view: RowView,
  bounds: RowBounds,
  zoom: { factor: number; y: number },
  table: RowTable = ROLL_ROW_ZOOM,
): RowView {
  const before = rowsHeight(bounds, view.rowPx);
  const at = before > 0 ? (view.top + zoom.y) / before : 0;
  const rowPx = clamp(view.rowPx * zoom.factor, table.minPx, table.maxPx);
  return clampRows({ rowPx, top: at * rowsHeight(bounds, rowPx) - zoom.y }, bounds, table);
}

/**
 * The view from `start` to `end`, each a share of the rows' height (0 the
 * top row, 1 the bottom), as near as the bounds allow, with the `hold`
 * edge on the row it was on.
 */
export function spanRows(
  view: RowView,
  bounds: RowBounds,
  span: { start: number; end: number; hold: ViewEdge },
  table: RowTable = ROLL_ROW_ZOOM,
): RowView {
  if (bounds.scaled <= 0) return clampRows(view, bounds, table);
  const share = Math.max(Number.EPSILON, span.end - span.start);
  const wanted = bounds.heightPx / share;
  const rowPx = clamp((wanted - bounds.fixedPx) / bounds.scaled, table.minPx, table.maxPx);
  const height = rowsHeight(bounds, rowPx);
  const top = span.hold === 'start' ? span.start * height : span.end * height - bounds.heightPx;
  return clampRows({ rowPx, top }, bounds, table);
}

/** A view along one bar: its start and end, each a share of the whole (0 to 1). */
export interface AxisShare {
  readonly start: number;
  readonly end: number;
}

/** A thumb on its track, in px from the track's start. */
export interface Thumb {
  readonly start: number;
  readonly length: number;
}

/** A thumb's least length on a track `trackPx` long: `leastPx`, never over half the track. */
export const leastThumb = (trackPx: number, leastPx: number): number =>
  Math.max(0, Math.min(leastPx, trackPx / 2));

/**
 * The thumb for `share` on a track `trackPx` long. The view's shares run
 * along the track less the least length, and the thumb is that span plus
 * the least length, so it is never shorter than the least, fills the track
 * when the whole is shown, and each of its ends moves only with that edge
 * of the view.
 */
export function thumbOf(share: AxisShare, trackPx: number, leastPx: number): Thumb {
  const least = leastThumb(trackPx, leastPx);
  const travel = trackPx - least;
  const start = clamp(share.start, 0, 1) * travel;
  const end = clamp(share.end, 0, 1) * travel + least;
  return { start, length: Math.max(least, end - start) };
}

/** The share of the whole `px` of thumb travel moves an edge: the inverse of `thumbOf`. */
export const fracAt = (px: number, trackPx: number, leastPx: number): number => {
  const travel = trackPx - leastThumb(trackPx, leastPx);
  return travel > 0 ? px / travel : 0;
};
