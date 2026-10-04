/**
 * The Roll's view settings (windsor#602 decision 2), without the DOM: Snap,
 * Keys, Fold, the two zooms, and the last length a note was drawn or
 * resized to (windsor#603). They are console state, kept per part by slot
 * for the session and never written to the song. The device and the
 * Expanded view keep separate zooms. The Audition switch is the console's,
 * not a part's (`rollAudition.ts`).
 *
 * The ↔ zoom is px per beat, or Fit (null): the region in the notes pane's
 * width, refitted whenever that width changes. − and + leave Fit from the
 * width it had, and Fit restores it. The ↕ zoom steps through the row
 * heights.
 */
import { PPQ } from '@windsor/engine';
import type { RollKeys } from './rollRows';
import {
  ROLL_ROW_DEFAULT,
  ROLL_ROW_PX,
  ROLL_SNAP_DEFAULT,
  ROLL_SNAPS,
  ROLL_TIME_ZOOM,
  type RollSnap,
} from './rollTables';

/** One view's zoom: px per beat (null is Fit) and the row height's index. */
export interface RollZoom {
  readonly beatPx: number | null;
  readonly row: number;
}

/** Which of the two views: the device in the pane, or Expanded. */
export type RollViewKind = 'device' | 'wide';

/** A part's view settings. */
export interface RollViewState {
  snap: number;
  keys: RollKeys;
  fold: boolean;
  /** The length the next added note takes, in ticks: the last drawn or resized, at first the opening snap's. */
  lastTicks: number;
  zoom: Record<RollViewKind, RollZoom>;
}

/** A roll as it first opens: 1/16, 12 keys, unfolded, a note a sixteenth long, both zooms at Fit. */
export const defaultRollView = (): RollViewState => ({
  snap: ROLL_SNAP_DEFAULT,
  keys: '12',
  fold: false,
  lastTicks: ROLL_SNAPS[ROLL_SNAP_DEFAULT]?.ticks ?? 1,
  zoom: {
    device: { beatPx: null, row: ROLL_ROW_DEFAULT.device },
    wide: { beatPx: null, row: ROLL_ROW_DEFAULT.wide },
  },
});

/** The session's view settings, by part slot. */
const VIEWS = new Map<number, RollViewState>();

/** The part on `slot`'s view settings, made on first use. */
export function rollViewOf(slot: number, views: Map<number, RollViewState> = VIEWS): RollViewState {
  let view = views.get(slot);
  if (!view) {
    view = defaultRollView();
    views.set(slot, view);
  }
  return view;
}

/** The Snap choice at `index`, clamped to the table. */
export const snapOf = (index: number, snaps: readonly RollSnap[] = ROLL_SNAPS): RollSnap =>
  snaps[Math.max(0, Math.min(snaps.length - 1, index))] as RollSnap;

/** The length a new note takes: the last length used, never under one snap (`snapTicks`). */
export const addTicksOf = (view: RollViewState, snapTicks: number): number =>
  Math.max(snapTicks, view.lastTicks);

/** Fit: the px per beat that lays `regionTicks` across `widthPx`, never under the zoom's floor. */
export function fitBeatPx(widthPx: number, regionTicks: number, zoom = ROLL_TIME_ZOOM): number {
  const beats = regionTicks / PPQ;
  if (!(beats > 0)) return zoom.minBeatPx;
  return Math.max(zoom.minBeatPx, (widthPx - zoom.fitInsetPx) / beats);
}

/** The px per beat a zoom draws at, given what Fit is now. */
export const beatPxOf = (zoom: RollZoom, fit: number): number => zoom.beatPx ?? fit;

/** One − (−1) or + (+1) of the ↔ zoom: it leaves Fit from the width Fit had. */
export function zoomTime(
  zoom: RollZoom,
  fit: number,
  dir: number,
  table = ROLL_TIME_ZOOM,
): RollZoom {
  const next = beatPxOf(zoom, fit) * table.step ** dir;
  return { ...zoom, beatPx: Math.max(table.minBeatPx, Math.min(table.maxBeatPx, next)) };
}

/** Fit restored. */
export const fitTime = (zoom: RollZoom): RollZoom => ({ ...zoom, beatPx: null });

/** One − or + of the ↕ zoom. */
export const zoomRows = (
  zoom: RollZoom,
  dir: number,
  rows: readonly number[] = ROLL_ROW_PX,
): RollZoom => ({ ...zoom, row: Math.max(0, Math.min(rows.length - 1, zoom.row + dir)) });

/** The ↕ zoom's row height in px. */
export const rowPxOf = (zoom: RollZoom, rows: readonly number[] = ROLL_ROW_PX): number =>
  rows[Math.max(0, Math.min(rows.length - 1, zoom.row))] as number;

/** The ↔ readout: `fit`, or the width of a bar of `barTicks`. */
export const timeZoomText = (zoom: RollZoom, beatPx: number, barTicks: number): string =>
  zoom.beatPx === null ? 'fit' : `${Math.round((beatPx * barTicks) / PPQ)} px/bar`;

/** The ↕ readout. */
export const rowZoomText = (zoom: RollZoom): string => `${rowPxOf(zoom)} px/row`;
