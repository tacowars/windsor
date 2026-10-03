/**
 * The frozen column's press guard (windsor#157, windsor#534 decision 9).
 * The one frozen column (the mixer strips, the lane labels, HARMONY and the
 * ruler's corner) stays put while the timeline scrolls under it, and
 * `console.css` paints the gaps beside it opaque with shadows; a shadow
 * takes no press, so a press in the gap after it, between two of its
 * blocks, or in the scroll's padding left of it would land on whatever
 * lane, loop strip or ruler has scrolled under it and edit a stretch of the
 * song the user cannot see. This drops such a press before it reaches them:
 * the pointer down, and the click and double-click that follow it (the
 * ruler's double-click zooms to fit by position). A press on one of the
 * column's blocks passes.
 */

/** The frozen blocks a press may land on: one a row group (`songLaneColumn.ts`). */
const FROZEN_CELLS = '.lane-frozen';

/** The events a press in a gap must not deliver to the timeline. */
const GUARDED_EVENTS = ['pointerdown', 'click', 'dblclick'] as const;

/** Where a press landed, as the guard reads it. */
export interface FrozenPress {
  /** Whether the press is on one of the frozen column's blocks. */
  readonly onFrozenCell: boolean;
  /** The press's `clientX`. */
  readonly clientX: number;
  /** The frozen column's right edge, in client pixels; null when none is drawn. */
  readonly frozenRight: number | null;
  /** The gap between the frozen column and the timeline. */
  readonly gapPx: number;
}

/** Whether a press lands in the frozen column but on no block of it: left of the timeline's visible edge. */
export const pressInFrozenGap = ({
  onFrozenCell,
  clientX,
  frozenRight,
  gapPx,
}: FrozenPress): boolean => !onFrozenCell && frozenRight !== null && clientX < frozenRight + gapPx;

/**
 * Stop, in the capture phase, every guarded event on the lanes left of the
 * timeline's visible edge that is not on a frozen block. It stops the
 * lanes' own listeners too, since a press between the rows has the lanes or
 * a row group as its target.
 */
export function guardFrozenColumns(lanes: HTMLElement, gapPx: number): void {
  const guard = (e: MouseEvent): void => {
    const onFrozenCell = e.target instanceof Element && e.target.closest(FROZEN_CELLS) !== null;
    const frozenRight = lanes.querySelector(FROZEN_CELLS)?.getBoundingClientRect().right ?? null;
    if (pressInFrozenGap({ onFrozenCell, clientX: e.clientX, frozenRight, gapPx })) {
      e.stopImmediatePropagation();
    }
  };
  for (const type of GUARDED_EVENTS) lanes.addEventListener(type, guard, true);
}
