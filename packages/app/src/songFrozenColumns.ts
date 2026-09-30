/**
 * The frozen columns' press guard (windsor#157). The names and the mixer
 * stay put while the timeline scrolls under them, and `console.css` paints
 * the gaps beside them opaque with shadows; a shadow takes no press, so a
 * press in a gap, or in the scroll's padding left of the names, would land
 * on whatever lane, loop strip or ruler has scrolled under it and edit a
 * stretch of the song the user cannot see. This drops such a press before
 * it reaches them. A press on a name or a mixer cell passes.
 */

/** The frozen cells a press may land on. */
const FROZEN_CELLS = '.lane-name, .mix-cell';

/**
 * Stop, in the capture phase, every press on the lanes grid left of the
 * timeline's visible edge (the mixer column's right edge plus the gap after
 * it) that is not on a frozen cell.
 */
export function guardFrozenColumns(lanes: HTMLElement, gapPx: number): void {
  lanes.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target instanceof Element && e.target.closest(FROZEN_CELLS)) return;
      const mixer = lanes.querySelector('.mix-cell');
      if (!mixer) return;
      if (e.clientX < mixer.getBoundingClientRect().right + gapPx) e.stopPropagation();
    },
    true,
  );
}
