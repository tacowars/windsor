/**
 * The Song view's one press-or-drag helper (#709): pointer capture, a
 * threshold between a click and a drag, and an abort for every release it
 * never saw. The part lanes, the harmony lane and the loop brace drag
 * through it, the way `chordDrag.ts` does it on a card. Split out of
 * `songLanes.ts` (windsor#551), which re-exports it for its older callers.
 * A drag starts on horizontal travel only, unless the caller opts a press
 * into both axes (`DragOptions.bothAxes`): the part lanes do for a body
 * press, which can drag a region straight down onto another part (record
 * `2026-10-07-song-region-drag-across-parts` decision 8).
 */
import { SONG_DRAG_THRESHOLD_PX, primaryHeld } from './songViewTables';

export interface DragHandlers {
  /** False refuses the press (the pointer is not on the handle). */
  accept?(e: PointerEvent): boolean;
  /** Every move past the threshold. */
  move(e: PointerEvent): void;
  /** The release; `moved` says whether the press became a drag. */
  end(e: PointerEvent, moved: boolean): void;
  /** A drag that ended without a release (cancel, lost capture, blur, a move with the button up): drop its preview. */
  abort(moved: boolean): void;
}

/** How a press counts its travel toward the drag threshold. */
export interface DragOptions {
  /** True when this press (the `pointerdown` it accepted) counts vertical travel too; horizontal only when absent. */
  bothAxes?(down: PointerEvent): boolean;
}

/** Whether a press that has travelled `dx`, `dy` px is past `threshold` and so a drag: on x alone, or with `bothAxes` the farther axis. */
export const pastThreshold = (
  travel: { readonly dx: number; readonly dy: number; readonly bothAxes: boolean },
  threshold: number = SONG_DRAG_THRESHOLD_PX,
): boolean => Math.max(Math.abs(travel.dx), travel.bothAxes ? Math.abs(travel.dy) : 0) >= threshold;

/**
 * A press-and-drag with pointer capture: under the threshold it is a click,
 * past it a drag. Only the pressing pointer's release commits (`end`); a
 * cancel, a lost capture, a window blur or a move with the primary button
 * up — a release it never saw — aborts, so a later hover never drags.
 */
export function pointerDrag(
  node: HTMLElement,
  handlers: DragHandlers,
  options: DragOptions = {},
): void {
  let live: { pointerId: number; x: number; y: number; both: boolean; moved: boolean } | null =
    null;
  const finish = (release: PointerEvent | null): void => {
    if (!live) return;
    const { pointerId, moved } = live;
    live = null;
    window.removeEventListener('blur', onBlur);
    if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
    if (release) handlers.end(release, moved);
    else handlers.abort(moved);
  };
  const onBlur = (): void => finish(null);
  const mine = (e: PointerEvent): boolean => live !== null && e.pointerId === live.pointerId;
  node.addEventListener('pointerdown', (down) => {
    if (down.button !== 0 || (handlers.accept && !handlers.accept(down))) return;
    down.stopPropagation();
    finish(null);
    live = {
      pointerId: down.pointerId,
      x: down.clientX,
      y: down.clientY,
      both: options.bothAxes?.(down) ?? false,
      moved: false,
    };
    try {
      node.setPointerCapture(down.pointerId);
    } catch {
      // A pointer the browser does not track (a synthetic event, a capture-less input): the drag still runs on the node's own events.
    }
    window.addEventListener('blur', onBlur);
  });
  node.addEventListener('pointermove', (e) => {
    if (!live || !mine(e)) return;
    if (!primaryHeld(e.buttons)) return void finish(null);
    const travel = { dx: e.clientX - live.x, dy: e.clientY - live.y, bothAxes: live.both };
    if (!live.moved && !pastThreshold(travel)) return;
    live.moved = true;
    handlers.move(e);
  });
  node.addEventListener('pointerup', (e) => {
    if (mine(e)) finish(e);
  });
  for (const type of ['pointercancel', 'lostpointercapture'] as const) {
    node.addEventListener(type, (e) => {
      if (mine(e)) finish(null);
    });
  }
}
