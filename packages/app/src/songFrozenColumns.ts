/**
 * The frozen columns' press guard (windsor#157). The names and the mixer
 * stay put while the timeline scrolls under them, and `console.css` paints
 * the gaps beside them opaque with shadows; a shadow takes no press, so a
 * press in a gap, or in the scroll's padding left of the names, would land
 * on whatever lane, loop strip or ruler has scrolled under it and edit a
 * stretch of the song the user cannot see. This drops such a press before
 * it reaches them: the pointer down, and the click and double-click that
 * follow it (the ruler's double-click zooms to fit by position). A press on
 * a name or a mixer cell passes.
 */

/** The frozen cells a press may land on. */
const FROZEN_CELLS = '.lane-name, .mix-cell';

/** The events a press in a gap must not deliver to the timeline. */
const GUARDED_EVENTS = ['pointerdown', 'click', 'dblclick'] as const;

/** Where a press landed, as the guard reads it. */
export interface FrozenPress {
  /** Whether the press is on a name or a mixer cell. */
  readonly onFrozenCell: boolean;
  /** The press's `clientX`. */
  readonly clientX: number;
  /** The mixer column's right edge, in client pixels; null when no part draws one. */
  readonly mixerRight: number | null;
  /** The gap between the mixer column and the timeline. */
  readonly gapPx: number;
}

/** Whether a press lands in the frozen columns but on no frozen cell: left of the timeline's visible edge. */
export const pressInFrozenGap = ({
  onFrozenCell,
  clientX,
  mixerRight,
  gapPx,
}: FrozenPress): boolean => !onFrozenCell && mixerRight !== null && clientX < mixerRight + gapPx;

/**
 * Stop, in the capture phase, every guarded event on the lanes grid left of
 * the timeline's visible edge that is not on a frozen cell. It stops the
 * lanes' own listeners too, since a press on the grid's background has the
 * lanes as its target.
 */
export function guardFrozenColumns(lanes: HTMLElement, gapPx: number): void {
  const guard = (e: MouseEvent): void => {
    const onFrozenCell = e.target instanceof Element && e.target.closest(FROZEN_CELLS) !== null;
    const mixerRight = lanes.querySelector('.mix-cell')?.getBoundingClientRect().right ?? null;
    if (pressInFrozenGap({ onFrozenCell, clientX: e.clientX, mixerRight, gapPx })) {
      e.stopImmediatePropagation();
    }
  };
  for (const type of GUARDED_EVENTS) lanes.addEventListener(type, guard, true);
}
