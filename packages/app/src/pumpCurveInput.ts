/**
 * The Pump editor's gestures, wired (record `2026-10-13-pump-insert`
 * decision 6). A press on a point drags it; on a bend handle, a vertical
 * drag bends its segment; anywhere else it adds a point there and drags it.
 * A double-click removes a point, or straightens a segment from its handle.
 * Points snap to the grid unless Alt is held. What each does is
 * `pumpCurveModel.ts`'s; this file reads the pointer and brackets each drag
 * in one undo step, as the EQ's curve does (`eqCurveInput.ts`).
 */
import type { PumpPoint } from '@windsor/engine';
import type { OpenGesture } from './gestureHooks';
import { dragGesture, withGesture } from './gestureHooks';
import { addPoint, bendPoint, hitPump, movePoint, removePoint, straighten } from './pumpCurveModel';
import type { PlotPoint, PumpPlot } from './pumpCurveModel';
import { PUMP_LABELS } from './pumpTables';

/** What the editor's gestures read and call on their card. */
export interface PumpCurveHost {
  readonly canvas: HTMLCanvasElement;
  /** The shape now, from the document. */
  points(): readonly PumpPoint[];
  plot(): PumpPlot;
  /** Commit `points` through `ctx.change` and repaint. */
  edit(points: readonly PumpPoint[]): void;
}

type Drag =
  | { readonly kind: 'point'; index: number; readonly gesture: OpenGesture }
  | {
      readonly kind: 'bend';
      readonly index: number;
      readonly from: number;
      readonly y: number;
      readonly gesture: OpenGesture;
    };

function local(canvas: HTMLCanvasElement, e: MouseEvent): PlotPoint {
  const box = canvas.getBoundingClientRect();
  return { x: e.clientX - box.left, y: e.clientY - box.top };
}

/** The drag a press at `at` starts, having made the press's own edit (an added point). */
function startDrag(host: PumpCurveHost, at: PlotPoint, free: boolean): Drag | null {
  const points = host.points();
  const hit = hitPump(points, at, host.plot());
  if (hit.kind === 'bend') {
    const gesture = dragGesture(PUMP_LABELS.undo);
    return { kind: 'bend', index: hit.index, from: points[hit.index]!.bend, y: at.y, gesture };
  }
  if (hit.kind === 'point') {
    return { kind: 'point', index: hit.index, gesture: dragGesture(PUMP_LABELS.undo) };
  }
  const added = addPoint(points, at, host.plot(), free);
  if (!added) return null;
  const gesture = dragGesture(PUMP_LABELS.undo);
  host.edit(added.points);
  return { kind: 'point', index: added.index, gesture };
}

function wirePointer(host: PumpCurveHost): void {
  const { canvas } = host;
  let drag: Drag | null = null;
  const stop = (e: PointerEvent): void => {
    drag?.gesture.close();
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.detail > 1) return;
    e.preventDefault();
    canvas.focus();
    drag?.gesture.close();
    drag = startDrag(host, local(canvas, e), e.altKey);
    if (drag) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const at = local(canvas, e);
    if (!drag?.gesture.open) {
      const hit = hitPump(host.points(), at, host.plot());
      canvas.style.cursor =
        hit.kind === 'none' ? 'crosshair' : hit.kind === 'bend' ? 'ns-resize' : 'grab';
      return;
    }
    if ((e.buttons & 1) === 0) return stop(e);
    const points = host.points();
    host.edit(
      drag.kind === 'bend'
        ? bendPoint(points, drag.index, drag.from, drag.y - at.y)
        : movePoint(points, drag.index, at, host.plot(), e.altKey),
    );
  });
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('lostpointercapture', stop);
}

function wireDoubleClick(host: PumpCurveHost): void {
  host.canvas.addEventListener('dblclick', (e) => {
    const points = host.points();
    const hit = hitPump(points, local(host.canvas, e), host.plot());
    if (hit.kind === 'none') return;
    const next =
      hit.kind === 'point' ? removePoint(points, hit.index) : straighten(points, hit.index);
    withGesture(PUMP_LABELS.undo, () => host.edit(next));
  });
}

/** Wire every gesture of the editor on `host.canvas`. */
export function wirePumpCurve(host: PumpCurveHost): void {
  wirePointer(host);
  wireDoubleClick(host);
}
