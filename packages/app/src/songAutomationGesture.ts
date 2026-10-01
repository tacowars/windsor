/**
 * The pointer on a lane's curve (windsor#349; record
 * `2026-10-01-song-automation-lanes` decision 13): the toolbar's Edit and
 * Draw tools, wired to one lane's timeline.
 *
 * - **Edit**: a click adds a point, at the clicked value or, on or near the
 *   line, on it; a drag on a point moves it; a vertical drag on the line
 *   bends that segment; Alt-click on the line straightens it; a double-click
 *   on a point deletes it. Shift ignores snap.
 * - **Draw**: a drag writes points on the snap grain over the range drawn.
 *
 * A gesture previews on the lane alone while the pointer is down and commits
 * once on release, the lane's whole point list as one undo step. Escape, a
 * cancel, a lost capture or a blur put the lane back as the document has it.
 * The rules are `songAutomationEdit.ts`; this file only reads the pointer.
 */
import type { AutomationPoint, AutomationTargetRow } from '@windsor/engine';
import { valueAt } from '@windsor/engine';
import {
  addPoint,
  deletePoint,
  displayAtPx,
  draggedBend,
  drawGrain,
  movePoint,
  pressAt,
  snapTick,
  strokePoints,
  strokeTo,
  tickAtPx,
  valueAtPx,
  withBend,
  type LaneFrame,
  type LanePress,
  type StrokePosition,
} from './songAutomationEdit';
import { AUTOMATION_GESTURES } from './songAutomationTables';
import { isFieldFocused } from './songAutomationToolbar';
import type { SongView } from './songTab';
import { SONG_VIEW } from './songViewTables';

/** One lane's timeline, what it moves, and how it reads, redraws and commits. */
export interface LaneEditing {
  readonly view: SongView;
  readonly timeline: HTMLElement;
  readonly row: AutomationTargetRow;
  /** The lane's name, for the undo label ("Move Cutoff point"). */
  readonly name: string;
  /** The lane's points as the document holds them now. */
  points(): readonly AutomationPoint[];
  /** Redraw the curve in place with `points`, the document untouched. */
  draw(points: readonly AutomationPoint[]): void;
  /** Commit `points` as the lane's whole list, one undo step named `label`. */
  commit(label: string, points: readonly AutomationPoint[]): void;
}

/** A gesture in progress, from its press. */
type Drag =
  | { readonly mode: 'point'; readonly index: number }
  | { readonly mode: 'space'; readonly press: Extract<LanePress, { kind: 'space' }> }
  | {
      readonly mode: 'draw';
      readonly samples: Map<number, number>;
      last: StrokePosition | null;
    };

interface Live {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly start: readonly AutomationPoint[];
  readonly drag: Drag;
  moved: boolean;
  /** The preview drawn, which the release commits; null while nothing has changed. */
  draft: readonly AutomationPoint[] | null;
}

/** Wire the Edit and Draw tools onto `lane.timeline`. */
// eslint-disable-next-line max-lines-per-function -- one gesture's press, moves, release and cancel share its state and read as one sequence
export function wireLaneEditing(lane: LaneEditing): void {
  const { view, timeline, row } = lane;
  let live: Live | null = null;
  const frame = (): LaneFrame => ({
    pxPerBar: view.state.pxPerBar,
    heightPx: SONG_VIEW.automationLanePx,
    songTicks: view.songTicks(),
  });
  const at = (e: PointerEvent | MouseEvent): { x: number; y: number } => {
    const box = timeline.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };
  const snapped = (x: number, e: PointerEvent): number =>
    snapTick(tickAtPx(x, frame()), view.state.automationSnap, view.songTicks(), e.shiftKey);
  const preview = (points: readonly AutomationPoint[]): void => {
    if (!live) return;
    live.draft = points;
    lane.draw(points);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || isFieldFocused(e)) return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };
  const stop = (): Live | null => {
    const ended = live;
    live = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', cancel);
    if (ended && timeline.hasPointerCapture(ended.pointerId)) {
      timeline.releasePointerCapture(ended.pointerId);
    }
    return ended;
  };
  function cancel(): void {
    const ended = stop();
    if (ended?.draft) lane.draw(ended.start);
  }
  const commit = (label: string, points: readonly AutomationPoint[]): void => {
    stop();
    lane.commit(label, points);
  };
  const drawTo = (e: PointerEvent): void => {
    if (!live || live.drag.mode !== 'draw') return;
    const { x, y } = at(e);
    const position = { tick: tickAtPx(x, frame()), display: displayAtPx(y, frame()) };
    const grain = { ticks: drawGrain(view.state.automationSnap), songTicks: view.songTicks() };
    strokeTo(live.drag.samples, live.drag.last, position, grain);
    live.drag.last = position;
    preview(strokePoints(row, live.start, live.drag.samples));
  };

  /** The press's gesture, or null when the press did its whole edit (Alt-click). */
  const pressDrag = (e: PointerEvent, start: readonly AutomationPoint[]): Drag | null => {
    if (view.state.automationTool === 'draw')
      return { mode: 'draw', samples: new Map(), last: null };
    const press = pressAt(row, start, frame(), at(e));
    if (press.kind === 'point') return { mode: 'point', index: press.index };
    if (e.altKey && press.near && press.segment !== null) {
      if (start[press.segment]!.bend !== 0) {
        lane.commit(`Straighten ${lane.name} line`, withBend(start, press.segment, 0));
      }
      return null;
    }
    return { mode: 'space', press };
  };

  timeline.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
    const start = lane.points();
    const drag = pressDrag(e, start);
    if (!drag) return;
    const { x, y } = at(e);
    live = { pointerId: e.pointerId, x, y, start, drag, moved: false, draft: null };
    try {
      timeline.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser does not track (a synthetic event): the gesture still runs on the lane's own events.
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', cancel);
    drawTo(e);
  });

  timeline.addEventListener('pointermove', (e) => {
    if (!live || e.pointerId !== live.pointerId) return;
    if (live.drag.mode === 'draw') return drawTo(e);
    const { x, y } = at(e);
    if (!live.moved && Math.hypot(x - live.x, y - live.y) < AUTOMATION_GESTURES.dragThresholdPx) {
      return;
    }
    live.moved = true;
    const { drag, start } = live;
    if (drag.mode === 'point') {
      const to = { tick: snapped(x, e), value: valueAtPx(row, y, frame()) };
      preview(movePoint(start, drag.index, to));
    } else if (drag.press.near && drag.press.segment !== null) {
      const bend = draggedBend(start[drag.press.segment]!.bend, y - live.y);
      preview(withBend(start, drag.press.segment, bend));
    }
  });

  timeline.addEventListener('pointerup', (e) => {
    if (!live || e.pointerId !== live.pointerId) return;
    const { drag, start, moved, draft } = live;
    if (drag.mode === 'draw') {
      return draft ? commit(`Draw ${lane.name}`, draft) : void stop();
    }
    if (drag.mode === 'point') {
      return moved && draft ? commit(`Move ${lane.name} point`, draft) : void stop();
    }
    if (moved) return draft ? commit(`Bend ${lane.name} line`, draft) : void stop();
    const { x, y } = at(e);
    const tick = snapped(x, e);
    const value = drag.press.near ? valueAt(row, start, tick) : valueAtPx(row, y, frame());
    commit(`Add ${lane.name} point`, addPoint(start, tick, value).points);
  });

  for (const type of ['pointercancel', 'lostpointercapture'] as const) {
    timeline.addEventListener(type, (e) => {
      if (live && e.pointerId === live.pointerId) cancel();
    });
  }

  timeline.addEventListener('dblclick', (e) => {
    if (view.state.automationTool !== 'edit') return;
    const start = lane.points();
    const press = pressAt(row, start, frame(), at(e));
    if (press.kind !== 'point' || start.length <= 1) return;
    lane.commit(`Delete ${lane.name} point`, deletePoint(start, press.index));
  });
}
