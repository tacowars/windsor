/**
 * Pressing and dragging a chip of the chord picker (#607).
 *
 * A press auditions the chip's chord through the chord part; a release under
 * the drag threshold ends there. Past the threshold the press becomes a drag:
 * the audition stops, the pointer carries a ghost of the chip, and a release
 * over a step writes that step (or appends one past the last). Pointer events
 * with capture, the pattern `envelopeDrag.ts` (#588) uses, because HTML5
 * drag-and-drop never starts on touch.
 *
 * The state machine is the whole behaviour and knows no DOM: it is handed
 * `targetAt`, `paint`, `apply`, `audition` and `silence` and is tested
 * through fakes. The card's `chordPicker.ts` supplies those.
 */
import { CHORD_DRAG_THRESHOLD_PX } from './chordConstants';
import type { ChordPayload } from './chordStepModel';

/** What the view needs to draw one frame of a drag; `null` means "drag over". */
export interface ChordDragPaint {
  readonly payload: ChordPayload;
  /** The step index under the pointer (the list's length means "append"), or null. */
  readonly over: number | null;
  readonly x: number;
  readonly y: number;
}

export interface ChordDragHost {
  /** The step index under this client point, the list's length for the append zone, or null. */
  targetAt(x: number, y: number): number | null;
  paint(state: ChordDragPaint | null): void;
  /** The drop: write `payload` onto step `index`. */
  apply(payload: ChordPayload, index: number): void;
  /** Sound the chip; the controller balances every call with `silence`. */
  audition(payload: ChordPayload): void;
  silence(): void;
}

export interface ChordDragController {
  readonly dragging: boolean;
  down(payload: ChordPayload, x: number, y: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
  cancel(): void;
}

export function createChordDrag(
  host: ChordDragHost,
  thresholdPx: number = CHORD_DRAG_THRESHOLD_PX,
): ChordDragController {
  let payload: ChordPayload | null = null;
  let dragging = false;
  let sounding = false;
  let start = { x: 0, y: 0 };

  const hush = (): void => {
    if (!sounding) return;
    sounding = false;
    host.silence();
  };
  const reset = (): void => {
    const wasDragging = dragging;
    hush();
    payload = null;
    dragging = false;
    if (wasDragging) host.paint(null);
  };

  return {
    get dragging(): boolean {
      return dragging;
    },
    down(next, x, y) {
      reset();
      payload = next;
      start = { x, y };
      sounding = true;
      host.audition(next);
    },
    move(x, y) {
      if (!payload) return;
      if (!dragging) {
        if (Math.hypot(x - start.x, y - start.y) < thresholdPx) return;
        dragging = true;
        hush();
      }
      host.paint({ payload, over: host.targetAt(x, y), x, y });
    },
    up(x, y) {
      const source = payload;
      const wasDragging = dragging;
      reset();
      if (!source || !wasDragging) return;
      const to = host.targetAt(x, y);
      if (to !== null) host.apply(source, to);
    },
    cancel() {
      reset();
    },
  };
}
