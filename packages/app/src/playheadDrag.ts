/**
 * The Song view's playhead drag (windsor#102), as pure rules: when the line
 * can be grabbed, which bar a pointer snaps it to, and the drag's small state
 * machine. `songRuler.ts` wires them to the line's handle, its label, and the
 * engine's seek (`ctx.transport.seek`) does the moving; nothing here keeps a
 * position of its own.
 *
 * - **When** (decision 1): only with audio on and the transport halted,
 *   stopped or paused. While it plays the handle takes no press at all, so
 *   the ruler's zoom and scroll work under it as before (decision 7).
 * - **Snap** (decision 3): always to the nearest bar line, with no finer mode
 *   and no modifier. A pointer exactly half-way between two lines takes the
 *   later one.
 * - **Range** (decision 4): bar 1 to the song's last bar. A drop before bar 1
 *   lands on bar 1, one past the song's end on the last bar. The loop brace
 *   does not limit it: the engine plays on from a bar outside the loop and
 *   loops once it reaches it.
 *
 * Bars here are 0-based indices, the ones `TICKS_PER_BAR` multiplies into
 * transport ticks; the ruler labels them from 1.
 */
import { TICKS_PER_BAR } from '@windsor/engine';

import { SONG_DRAG_THRESHOLD_PX, primaryHeld } from './songViewTables';

/** What decides whether the line can be grabbed. */
export interface PlayheadGrabState {
  /** Audio is on: a live system exists to seek. */
  readonly enabled: boolean;
  /** The transport is issuing ticks. */
  readonly running: boolean;
}

/** Stopped or paused with audio on (decision 1). */
export function canDragPlayhead(state: PlayheadGrabState): boolean {
  return state.enabled && !state.running;
}

/** The ruler's geometry a drag snaps against. */
export interface PlayheadDragGeometry {
  /** px one bar spans at the current zoom. */
  readonly pxPerBar: number;
  /** The song's length in bars. */
  readonly bars: number;
}

/**
 * The bar line nearest `px`, measured from bar 1's line, clamped to bar 1 ..
 * the last bar. Half-way snaps to the later line. A song with no bars, or a
 * ruler with no width, answers bar 1.
 */
export function snapBar(px: number, geometry: PlayheadDragGeometry): number {
  const { pxPerBar, bars } = geometry;
  if (!(bars > 0) || !(pxPerBar > 0) || !Number.isFinite(px)) return 0;
  const nearest = Math.round(px / pxPerBar);
  return Math.min(Math.floor(bars) - 1, Math.max(0, nearest));
}

/** The transport tick a bar line sits on. */
export function barTick(bar: number, ticksPerBar: number = TICKS_PER_BAR): number {
  return bar * ticksPerBar;
}

/** A press on the handle: whether it starts a drag (the primary button, on a grabbable line). */
export function pressStartsDrag(button: number, state: PlayheadGrabState): boolean {
  return button === 0 && canDragPlayhead(state);
}

/** A drag in progress. */
export interface PlayheadDrag {
  readonly pointerId: number;
  /** The press's `clientX`: a drag begins once the pointer leaves it by the threshold. */
  readonly originX: number;
  /** The bar the line is previewed on; null until the pointer has moved past the threshold. */
  readonly bar: number | null;
}

export type PlayheadDragEvent =
  | {
      readonly type: 'move';
      readonly pointerId: number;
      readonly buttons: number;
      readonly clientX: number;
      /** The pointer's px from bar 1's line. */
      readonly px: number;
    }
  | { readonly type: 'up'; readonly pointerId: number }
  | { readonly type: 'cancel' };

/** What a step leaves: the drag (null once it ended), the bar to preview the line on, and the bar to seek to. */
export interface PlayheadDragStep {
  readonly drag: PlayheadDrag | null;
  /** The line moved to this bar: place it there, no seek yet. */
  readonly preview: number | null;
  /** The drag ended on this bar: seek. Null when it ended without one (a cancel, a press that never moved). */
  readonly drop: number | null;
}

const ended = (drop: number | null): PlayheadDragStep => ({ drag: null, preview: null, drop });

/**
 * One event through the drag. A move of the pressing pointer past the
 * threshold previews the snapped bar; a release drops on the previewed bar,
 * and so does a move with the button up (a release the browser never
 * delivered: the user let go where the line shows). A cancel, a lost capture
 * or a blur ends it with no drop, so the line returns to the transport's
 * position. A press released without moving drops nothing.
 */
export function stepPlayheadDrag(
  drag: PlayheadDrag | null,
  event: PlayheadDragEvent,
  geometry: PlayheadDragGeometry,
  thresholdPx: number = SONG_DRAG_THRESHOLD_PX,
): PlayheadDragStep {
  if (!drag) return ended(null);
  if (event.type === 'cancel') return ended(null);
  if (event.pointerId !== drag.pointerId) return { drag, preview: null, drop: null };
  if (event.type === 'up' || !primaryHeld(event.buttons)) return ended(drag.bar);
  if (drag.bar === null && Math.abs(event.clientX - drag.originX) < thresholdPx) {
    return { drag, preview: null, drop: null };
  }
  const bar = snapBar(event.px, geometry);
  return { drag: bar === drag.bar ? drag : { ...drag, bar }, preview: bar, drop: null };
}
