/**
 * The Shape tool on a host's lanes (windsor#350 decisions 1, 2 and 5;
 * record `2026-10-01-song-automation-lanes` decision 13): the range gesture,
 * the selection it leaves, its dashed preview, and the popover's life.
 *
 * - **The range**: a drag across a lane selects a snapped span, outlined in
 *   the lane's colour; a press that does not drag selects the bar under it.
 *   Shift ignores snap, as under Edit.
 * - **The popover** (`songShapePopover.ts`) opens below the lane at the
 *   range's start. It is fixed to the window and placed again on every
 *   scroll, resize and repaint, so it follows the lanes' horizontal scroll
 *   and stays inside the lanes' viewport. While its container is hidden
 *   nothing is measured; it is placed on the first frame it shows
 *   (`songShapePlacer.ts`). Too tall for the window, it is capped and its
 *   body scrolls under the pinned Apply and Cancel.
 * - **The preview** is the lane's points with the range replaced by the
 *   engine's stamp (`songShapeModel.ts`), drawn dashed over the curve. The
 *   document is untouched until Apply, which commits the lane's whole list
 *   as one undo step through the lane's own `commit`.
 * - **Closing**: Apply, Cancel, Escape, another tool, or the lane leaving
 *   the view (folded, deleted, a render).
 *
 * The selection lives for one render of the lanes; the shape, rate, phase
 * and duty it last used are the host's tool state (`AutomationToolState.shape`,
 * `automationEditHost.ts`, windsor#706). The axis and the frame are each
 * lane's host's, so the range clamps to the song or to a roll's loop.
 */
import type { AutomationPoint, AutomationShapeSpec, AutomationTargetRow } from '@windsor/engine';
import {
  hostBarTicks,
  hostCurveFrame,
  hostFrame,
  type AutomationEditHost,
  type AutomationToolState,
} from './automationEditHost';
import { curveShape } from './songAutomationCurve';
import { snapTick, tickAtPx } from './songAutomationEdit';
import { AUTOMATION_GESTURES } from './songAutomationTables';
import { isFieldFocused } from './songAutomationToolbar';
import {
  popoverPlacement,
  settingsOf,
  shapeDraft,
  shapeLabel,
  shapeRange,
  shapeReadout,
  shapedPoints,
  stampedPoints,
  type ShapeRange,
} from './songShapeModel';
import { shapePlacer } from './songShapePlacer';
import { shapePopover } from './songShapePopover';
import { type ShapeRate, shapeRates } from './songShapeTables';
import { tickToPx } from './songViewTables';

/** One lane the Shape tool can select on. */
export interface ShapeLane {
  readonly host: AutomationEditHost;
  /** Names the lane across repaints: its part's slot and its target. */
  readonly key: string;
  readonly timeline: HTMLElement;
  readonly row: AutomationTargetRow;
  readonly name: string;
  /** The lane's points as the document holds them now. */
  points(): readonly AutomationPoint[];
  /** Commit `points` as the lane's whole list, one undo step named `label`. */
  commit(label: string, points: readonly AutomationPoint[]): void;
  /** How Top and Bottom read in the popover; the row's own readout when absent (a roll's offsets, windsor#708). */
  readonly valueText?: (value: number) => string;
}

export interface ShapeTool {
  /** Wire the range gesture onto a lane; `refresh` shows the selection on it when it is this lane's. */
  attach(lane: ShapeLane): void;
  /** After the lanes repaint: the selection shown again and the popover placed, or closed when its lane is gone. */
  refresh(): void;
  /** The toolbar's tool changed: anything but Shape closes the popover. */
  toolChanged(): void;
  close(): void;
}

interface Selection {
  readonly key: string;
  readonly range: ShapeRange;
  draft: AutomationShapeSpec;
}

interface RangeDrag {
  readonly lane: ShapeLane;
  readonly pointerId: number;
  readonly x: number;
  readonly pressTick: number;
  readonly fromTick: number;
  toTick: number;
  dragged: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The Rate stops in the lane's host's meter. */
const ratesOf = (lane: ShapeLane): readonly ShapeRate[] => shapeRates(hostBarTicks(lane.host));

/** Outline `range` on the lane, with `preview` dashed over its curve when given. */
function decorate(lane: ShapeLane, range: ShapeRange, preview?: readonly AutomationPoint[]): void {
  undecorate(lane);
  const frame = hostCurveFrame(lane.host);
  const { pxPerBar: px, ticksPerBar: bar } = frame;
  const box = document.createElement('div');
  box.className = 'auto-range';
  box.style.left = `${tickToPx(range.startTick, px, bar)}px`;
  box.style.width = `${tickToPx(range.endTick - range.startTick, px, bar)}px`;
  lane.timeline.appendChild(box);
  if (!preview) return;
  const shape = curveShape(lane.row, preview, frame);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'auto-preview');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', String(frame.widthPx));
  svg.setAttribute('height', String(frame.heightPx));
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', shape.line);
  svg.appendChild(path);
  lane.timeline.appendChild(svg);
}

function undecorate(lane: ShapeLane): void {
  for (const node of lane.timeline.querySelectorAll('.auto-range, .auto-preview')) node.remove();
}

/** Where the Shape tool's popover lives, and the tool state it reads and writes. */
export interface ShapeToolMount {
  /** Holds the popover; while it is hidden, nothing is measured. */
  readonly container: HTMLElement;
  /** The lanes' scrolling viewport, whose visible edges keep the popover in. */
  viewport(): Element | null;
  readonly tools: AutomationToolState;
}

/** The Shape tool for one render of the lanes. */
// eslint-disable-next-line max-lines-per-function -- the selection, its gesture, its popover and their listeners share one state and read as one lifecycle
export function shapeTool(mount: ShapeToolMount): ShapeTool {
  const { container, tools: state } = mount;
  const lanes = new Map<string, ShapeLane>();
  let selection: Selection | null = null;
  let drag: RangeDrag | null = null;

  const selectedLane = (): ShapeLane | undefined =>
    selection ? lanes.get(selection.key) : undefined;

  const layout = (): void => {
    const lane = selectedLane();
    const scroll = mount.viewport();
    if (!selection || !lane || !scroll) return;
    const node = popover.element;
    node.style.maxHeight = '';
    const box = lane.timeline.getBoundingClientRect();
    const view = scroll.getBoundingClientRect();
    const frame = hostFrame(lane.host);
    const at = popoverPlacement({
      anchorX: box.left + tickToPx(selection.range.startTick, frame.pxPerBar, frame.ticksPerBar),
      laneTop: box.top,
      laneBottom: box.bottom,
      viewLeft: Math.max(0, view.left),
      viewRight: Math.min(window.innerWidth, view.right),
      viewportHeight: window.innerHeight,
      width: node.offsetWidth,
      height: node.offsetHeight,
    });
    node.style.left = `${at.left}px`;
    node.style.top = `${at.top}px`;
    node.style.maxHeight = at.maxHeight === null ? '' : `${at.maxHeight}px`;
  };
  // Hidden (another tab): nothing is measured; it is placed on the first frame the container shows.
  const placer = shapePlacer({
    shown: () => container.closest('[hidden]') === null,
    place: layout,
    nextFrame: (cb) => window.requestAnimationFrame(cb),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  });
  const place = (): void => placer.request();

  const show = (): void => {
    const lane = selectedLane();
    if (!selection || !lane) return;
    const { range, draft } = selection;
    const stamp = stampedPoints(lane.row, range, draft);
    decorate(lane, range, shapedPoints(lane.points(), range, stamp));
    const meter = lane.host.meter();
    const readout = shapeReadout(range, draft, stamp.length, meter);
    const text = lane.valueText ? { valueText: lane.valueText } : {};
    popover.show(draft, { name: lane.name, row: lane.row, readout, rates: ratesOf(lane), ...text });
    place();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    const inPopover = e.target instanceof Node && popover.element.contains(e.target);
    if (isFieldFocused(e) && !inPopover) return;
    e.preventDefault();
    e.stopPropagation();
    if (drag) endDrag();
    else close();
  };
  const listen = (on: boolean): void => {
    if (on) {
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', place, { capture: true, passive: true });
      window.addEventListener('resize', place);
      return;
    }
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
  };

  function close(): void {
    const lane = selectedLane();
    if (lane) undecorate(lane);
    if (selection) listen(false);
    placer.stop();
    selection = null;
    popover.element.remove();
  }

  const popover = shapePopover({
    change(draft) {
      if (!selection) return;
      selection.draft = draft;
      state.shape = settingsOf(draft);
      show();
    },
    apply() {
      const lane = selectedLane();
      if (!selection || !lane) return close();
      const { range, draft } = selection;
      const next = shapedPoints(lane.points(), range, stampedPoints(lane.row, range, draft));
      close();
      lane.commit(`${shapeLabel(draft.kind)} on ${lane.name}`, next);
    },
    cancel: close,
  });

  const open = (lane: ShapeLane, range: ShapeRange): void => {
    selection = {
      key: lane.key,
      range,
      draft: shapeDraft(lane.row, lane.points(), range, state.shape, ratesOf(lane)),
    };
    container.appendChild(popover.element);
    listen(true);
    show();
    popover.focus();
  };

  function endDrag(): RangeDrag | null {
    const ended = drag;
    drag = null;
    if (!ended) return null;
    if (!selection) window.removeEventListener('keydown', onKey, true);
    if (ended.lane.timeline.hasPointerCapture(ended.pointerId)) {
      ended.lane.timeline.releasePointerCapture(ended.pointerId);
    }
    undecorate(ended.lane);
    return ended;
  }

  const wire = (lane: ShapeLane): void => {
    const { timeline } = lane;
    const xOf = (e: PointerEvent): number => e.clientX - timeline.getBoundingClientRect().left;
    const snapped = (x: number, e: PointerEvent): number =>
      snapTick(
        tickAtPx(x, hostFrame(lane.host)),
        state.automationSnap,
        lane.host.axisTicks(),
        e.shiftKey,
      );
    const outline = (d: RangeDrag): void =>
      decorate(lane, {
        startTick: Math.min(d.fromTick, d.toTick),
        endTick: Math.max(d.fromTick, d.toTick),
      });

    timeline.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || state.automationTool !== 'shape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
      endDrag();
      const x = xOf(e);
      const pressTick = tickAtPx(x, hostFrame(lane.host));
      const fromTick = snapped(x, e);
      drag = {
        lane,
        pointerId: e.pointerId,
        x,
        pressTick,
        fromTick,
        toTick: fromTick,
        dragged: false,
      };
      try {
        timeline.setPointerCapture(e.pointerId);
      } catch {
        // A pointer the browser does not track (a synthetic event): the drag still runs on the lane's own events.
      }
      window.addEventListener('keydown', onKey, true);
      outline(drag);
    });
    timeline.addEventListener('pointermove', (e) => {
      if (!drag || drag.lane !== lane || e.pointerId !== drag.pointerId) return;
      const x = xOf(e);
      drag.toTick = snapped(x, e);
      drag.dragged ||= Math.abs(x - drag.x) >= AUTOMATION_GESTURES.dragThresholdPx;
      outline(drag);
    });
    timeline.addEventListener('pointerup', (e) => {
      if (!drag || drag.lane !== lane || e.pointerId !== drag.pointerId) return;
      const ended = endDrag();
      if (ended) open(lane, shapeRange(ended, lane.host.axisTicks(), hostBarTicks(lane.host)));
    });
    for (const type of ['pointercancel', 'lostpointercapture'] as const) {
      timeline.addEventListener(type, (e) => {
        if (drag && drag.lane === lane && e.pointerId === drag.pointerId) endDrag();
      });
    }
  };

  return {
    attach(lane) {
      lanes.set(lane.key, lane);
      wire(lane);
    },
    refresh() {
      for (const [key, lane] of lanes) if (!lane.timeline.isConnected) lanes.delete(key);
      if (!selection) return;
      const lane = selectedLane();
      if (!lane || selection.range.endTick > lane.host.axisTicks()) return close();
      show();
    },
    toolChanged() {
      if (state.automationTool === 'shape') return;
      endDrag();
      close();
    },
    close() {
      endDrag();
      close();
    },
  };
}
