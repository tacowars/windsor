/**
 * The Roll's view settings (windsor#602 decision 2), without the DOM: Snap,
 * Keys, Fold, the two zooms, the last length a note was drawn or resized
 * to (windsor#603), the Envelopes tab's: the page shown, the tool and
 * the envelope shown (windsor#707 decision 2), and what the lane under the
 * notes shows, Vel, Acc or Rat (windsor#754). They are console state, kept per part by slot
 * for the session and never written to the song. The device and the
 * Expanded view keep separate zooms. The Audition switch is the console's,
 * not a part's (`rollAudition.ts`). The Expanded view also keeps where its
 * notes pane sat, so a part picked back opens at its own scroll.
 *
 * Each view's zoom (windsor#902; record `2026-10-18-roll-zoom-bars-and-duplicate`
 * decisions 1, 3 and 8) is a fit, Loop or Region, refitted whenever the
 * notes pane's width or the loop changes, or px per beat; and a row height
 * in px. A roll opens on its loop. The maths is `rollZoomModel.ts`'s.
 */
import { type RollPage, ROLL_ENVELOPE_TOOL_DEFAULT } from './rollEnvelopeTables';
import type { RollLane } from './rollMarks';
import type { RollKeys } from './rollRows';
import type { AutomationTool } from './songAutomationTables';
import { DEFAULT_SHAPE_SETTINGS, type ShapeSettings } from './songShapeTables';
import {
  ROLL_LANE_DEFAULT,
  ROLL_ROW_DEFAULT,
  ROLL_SNAP_DEFAULT,
  ROLL_SNAPS,
  ROLL_UNFIT_BEAT_PX,
  type RollSnap,
} from './rollTables';
import { type RollFit, type TimeBounds, clampTime, fitPx } from './rollZoomModel';

/**
 * One view's zoom: the fit it sits on, else `beatPx` px per beat; and the
 * row height in px.
 */
export interface RollZoom {
  readonly fit: RollFit | null;
  readonly beatPx: number;
  readonly rowPx: number;
}

/** Where a notes pane sits: the tick at its left edge and the pitch in its middle. */
export interface RollSpot {
  readonly tick: number;
  readonly pitch: number;
}

/** Which of the two views: the device in the pane, or Expanded. */
export type RollViewKind = 'device' | 'wide';

/**
 * The Envelopes tab's own settings: the tool picked, the target whose
 * envelope is shown, and the Shape tool's last settings (windsor#708).
 */
export interface RollEnvelopeView {
  tool: AutomationTool;
  shown: string | null;
  shape: ShapeSettings;
}

/** A part's view settings. */
export interface RollViewState {
  /** The tab shown: Notes or Envelopes. */
  page: RollPage;
  envelope: RollEnvelopeView;
  /** What the lane under the notes shows: the stems, the accents or the ratchets. */
  lane: RollLane;
  snap: number;
  keys: RollKeys;
  fold: boolean;
  /** The length the next added note takes, in ticks: the last drawn or resized, at first the opening snap's. */
  lastTicks: number;
  zoom: Record<RollViewKind, RollZoom>;
  /**
   * Where the Expanded view's notes pane last sat, or null before it opened:
   * a pick back to the part opens it there (windsor#873 decision 4).
   */
  wideSpot: RollSpot | null;
}

/**
 * A roll as it first opens: on Notes with the Vel lane, 1/16, 12 keys,
 * unfolded, a note a sixteenth long, both views on the loop, the device at
 * 7 px rows and Expanded at 15; Envelopes on its default tool, showing the
 * roll's first envelope.
 */
export const defaultRollView = (): RollViewState => ({
  page: 'notes',
  envelope: { tool: ROLL_ENVELOPE_TOOL_DEFAULT, shown: null, shape: DEFAULT_SHAPE_SETTINGS },
  lane: ROLL_LANE_DEFAULT,
  snap: ROLL_SNAP_DEFAULT,
  keys: '12',
  fold: false,
  lastTicks: ROLL_SNAPS[ROLL_SNAP_DEFAULT]?.ticks ?? 1,
  zoom: {
    device: { fit: 'loop', beatPx: ROLL_UNFIT_BEAT_PX, rowPx: ROLL_ROW_DEFAULT.device },
    wide: { fit: 'loop', beatPx: ROLL_UNFIT_BEAT_PX, rowPx: ROLL_ROW_DEFAULT.wide },
  },
  wideSpot: null,
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

/** The px per beat a zoom draws at in `bounds`: its fit's, or its own within the bounds. */
export function beatPxOf(zoom: RollZoom, bounds: TimeBounds): number {
  if (!(bounds.widthPx > 0)) return zoom.fit ? ROLL_UNFIT_BEAT_PX : zoom.beatPx;
  if (zoom.fit) return fitPx(zoom.fit, bounds);
  return clampTime({ beatPx: zoom.beatPx, left: 0 }, bounds).beatPx;
}
