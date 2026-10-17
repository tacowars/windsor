/**
 * Spectre's workbench pointer (record `2026-10-17-spectre-drawn-cells`
 * decision 10): a press on a lane starts a stroke of the tool in hand, and
 * each move continues it, one undo step a stroke (`dragGesture`).
 *
 * - **Draw** sets the cells it passes to where the pointer is, along the line
 *   from its last position, so a fast drag leaves no gap; with Shift, a press
 *   draws straight from the last stroke's end on that lane and channel, in
 *   this workbench. Levels and, on the delay lane, Snap round what it writes.
 * - **Push** raises or lowers by the drag, softly toward the brush's edges;
 *   **Smooth** evens the cells out; pen pressure scales both.
 * - **Erase** puts the cells it passes back at rest.
 * - **Select** marks the cells it spans across all three lanes: a plain drag
 *   replaces the selection, Shift adds, Alt takes away; a double-click clears.
 *   A press that does not move holds its step open a moment after release
 *   (`selectHold`), so a double-click's first press and its clear are one
 *   step, and an undo brings back the selection from before it (windsor#852).
 *
 * The rules are `spectreCellEdits.ts`'s; this file reads the pointer.
 */
import type { SpectreCurve, SpectreSpec } from '@windsor/engine';
import { dragGesture, mergedGesture } from './gestureHooks';
import type { MergedGesture, OpenGesture } from './gestureHooks';
import {
  drawStroke,
  editedCells,
  eraseAt,
  levelled,
  pushAt,
  selectCells,
  smoothAt,
  snappedTo,
  withCells,
} from './spectreCellEdits';
import type { BrushAt, SpectreChannel } from './spectreCellEdits';
import { cellOfX, laneAt, valueOfY } from './spectreBenchModel';
import type { SpectreBenchLayout, SpectreLaneBox } from './spectreBenchModel';
import { SPECTRE_BENCH_LABELS, SPECTRE_BRUSH, SPECTRE_TOOLS } from './spectreBenchTables';
import type { SpectreTool } from './spectreBenchTables';

/** What the pointer reads and calls on its workbench. */
export interface SpectreInputHost {
  readonly canvas: HTMLCanvasElement;
  layout(): SpectreBenchLayout;
  spec(): SpectreSpec;
  commit(next: SpectreSpec): void;
  tool(): SpectreTool;
  width(): number;
  levels(): number;
  snap(): boolean;
  /** The grid's step on the delay lane, a share of full scale; 0 off. */
  grid(): number;
  channel(): SpectreChannel;
  /** The pointer is over `cell` of `curve`, or off the lanes (null); the readout and the ring follow. */
  hover(at: { cell: number; curve: SpectreCurve } | null): void;
  setFocus(curve: SpectreCurve): void;
}

interface Stroke {
  readonly lane: SpectreLaneBox;
  readonly gesture: OpenGesture;
  prev: BrushAt;
  y: number;
  /** Select: the selection when the press came, the press's cell and how it combines. */
  readonly base: SpectreSpec;
  readonly anchor: number;
  readonly mode: 'replace' | 'add' | 'remove';
  /** Select, and the stroke has not left its first cell: its release holds the step for a double-click. */
  held: boolean;
  /** The workbench's last Draw stroke ends, by `drawnKey`, for Shift's straight line. */
  readonly drawn: Map<string, BrushAt>;
}

const drawnKey = (curve: SpectreCurve, channel: SpectreChannel): string => `${curve}:${channel}`;

function local(canvas: HTMLCanvasElement, e: PointerEvent | MouseEvent): { x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
}

/** The value Draw writes at `y` on `lane`: through Levels, and on the delay lane Snap. */
function drawnValue(host: SpectreInputHost, lane: SpectreLaneBox, y: number): number {
  const value = levelled(valueOfY(lane, y), host.levels());
  return lane.curve === 'delay' && host.snap() ? snappedTo(value, host.grid()) : value;
}

const pressure = (e: PointerEvent): number =>
  e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : SPECTRE_BRUSH.mousePressure * 2;

/** One step of the stroke in hand, to the pointer at `x`, `y`. */
function strokeTo(
  host: SpectreInputHost,
  stroke: Stroke,
  x: number,
  y: number,
  e: PointerEvent,
): void {
  const layout = host.layout();
  const lane = stroke.lane;
  const cell = cellOfX(layout, x);
  const spec = host.spec();
  const channel = host.channel();
  const cells = editedCells(spec, lane.curve, channel);
  const width = host.width();
  const tool = host.tool();
  const now: BrushAt = { cell, value: drawnValue(host, lane, y) };
  if (tool === 'select') {
    if (cell !== stroke.anchor) stroke.held = false;
    host.commit({
      ...selectCells(stroke.base, stroke.anchor, cell, stroke.mode),
      curves: spec.curves,
    });
    return;
  }
  let next: readonly number[] = cells;
  if (tool === 'draw') next = drawStroke(cells, stroke.prev, now, width);
  else if (tool === 'erase') {
    const from = Math.min(stroke.prev.cell, cell),
      to = Math.max(stroke.prev.cell, cell);
    for (let c = from; c <= to; c++) next = eraseAt(next, lane.curve, c, width);
  } else if (tool === 'push') {
    const amount = ((stroke.y - y) / lane.height) * SPECTRE_BRUSH.pushPerHeight * pressure(e);
    next = pushAt(cells, cell, width, amount);
  } else next = smoothAt(cells, cell, width, SPECTRE_BRUSH.smoothStrength * pressure(e));
  stroke.prev = now;
  stroke.y = y;
  if (tool === 'draw') stroke.drawn.set(drawnKey(lane.curve, channel), now);
  host.commit(withCells(spec, lane.curve, channel, next));
}

function toolLabel(tool: SpectreTool): string {
  return `${SPECTRE_BENCH_LABELS.undo} ${SPECTRE_TOOLS.find((t) => t.id === tool)?.label ?? ''}`;
}

/**
 * Select's held step (windsor#852): opened on a still press's release, inside
 * the press's step before that closes, it keeps the step open while the rest
 * of a double-click arrives on `canvas` (its click, its second press), so the
 * clear folds into it. Anything else (a key, a press elsewhere, a fresh
 * press) or the merge's timer closes it.
 */
function selectHold(canvas: EventTarget, win: EventTarget): MergedGesture {
  return mergedGesture({
    label: SPECTRE_BENCH_LABELS.select,
    continues: (e) =>
      e.target === canvas &&
      (e.type === 'click' || (e.type === 'pointerdown' && (e as PointerEvent).detail > 1)),
    win,
  });
}

/** A double-click's clear: into the first press's held step, or a step of its own once that closed. */
function clearSelection(host: SpectreInputHost, hold: MergedGesture): void {
  hold.touch();
  host.commit({ ...host.spec(), selection: [] });
  hold.close();
}

/** Wire the pointer on `host.canvas`; `win` hears the releases and inputs that end a step. */
export function wireSpectreBench(host: SpectreInputHost, win: EventTarget = window): void {
  const { canvas } = host;
  // Each open workbench starts with no stroke behind it.
  const drawn = new Map<string, BrushAt>();
  const hold = selectHold(canvas, win);
  let stroke: Stroke | null = null;
  const stop = (e: PointerEvent): void => {
    if (stroke?.held && stroke.gesture.open && e.type === 'pointerup') hold.touch();
    stroke?.gesture.close();
    stroke = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.detail > 1) return;
    const at = local(canvas, e);
    const lane = laneAt(host.layout(), at.y);
    if (!lane) return;
    e.preventDefault();
    canvas.focus();
    host.setFocus(lane.curve);
    stroke?.gesture.close();
    const tool = host.tool();
    const cell = cellOfX(host.layout(), at.x);
    const here: BrushAt = { cell, value: drawnValue(host, lane, at.y) };
    const last = drawn.get(drawnKey(lane.curve, host.channel()));
    const from = tool === 'draw' && e.shiftKey ? (last ?? here) : here;
    stroke = {
      lane,
      gesture: dragGesture(tool === 'select' ? SPECTRE_BENCH_LABELS.select : toolLabel(tool), win),
      prev: from,
      y: at.y,
      base: host.spec(),
      anchor: cell,
      mode: tool !== 'select' ? 'replace' : e.altKey ? 'remove' : e.shiftKey ? 'add' : 'replace',
      drawn,
      held: tool === 'select',
    };
    canvas.setPointerCapture(e.pointerId);
    strokeTo(host, stroke, at.x, at.y, e);
  });
  canvas.addEventListener('pointermove', (e) => {
    const at = local(canvas, e);
    const lane = stroke?.lane ?? laneAt(host.layout(), at.y);
    host.hover(lane ? { cell: cellOfX(host.layout(), at.x), curve: lane.curve } : null);
    if (!stroke?.gesture.open) return;
    if ((e.buttons & 1) === 0) return stop(e);
    strokeTo(host, stroke, at.x, at.y, e);
  });
  canvas.addEventListener('pointerleave', () => {
    if (!stroke) host.hover(null);
  });
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('lostpointercapture', stop);
  canvas.addEventListener('dblclick', (e) => {
    if (host.tool() !== 'select') return;
    e.preventDefault();
    clearSelection(host, hold);
  });
}
