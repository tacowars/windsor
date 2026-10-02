/**
 * When the Shape popover is placed (windsor#350, fix round for PR #398): a
 * placement asked for while the Song panel is hidden would read zero-sized
 * rects and pin the popover in the window's corner, so it waits instead.
 *
 * - **Shown**: the request places at once.
 * - **Hidden**: nothing is measured. One frame loop waits, checking `shown`
 *   each frame (layout-free: `closest('[hidden]')`, as `packages/app/CLAUDE.md`
 *   "Hidden tabs are hidden" asks), and places on the first frame the panel
 *   is shown. A tab showing fires no event, so the frame is the signal.
 * - **Stop**: the popover closed; a waiting loop ends.
 */

/** What the placer reads and calls; the browser's in `songShapeRange.ts`, fakes in its test. */
export interface ShapePlacerDeps {
  /** Whether the Song panel is shown now, without reading layout. */
  shown(): boolean;
  /** Measure and place the popover. */
  place(): void;
  nextFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

export interface ShapePlacer {
  /** Place now if shown, else on the first frame the panel is shown. */
  request(): void;
  /** Drop a waiting placement. */
  stop(): void;
}

export function shapePlacer(deps: ShapePlacerDeps): ShapePlacer {
  let waiting: number | null = null;
  const stop = (): void => {
    if (waiting !== null) deps.cancelFrame(waiting);
    waiting = null;
  };
  const wait = (): void => {
    waiting = deps.nextFrame(() => {
      waiting = null;
      if (deps.shown()) deps.place();
      else wait();
    });
  };
  return {
    request() {
      if (deps.shown()) {
        stop();
        deps.place();
      } else if (waiting === null) {
        wait();
      }
    },
    stop,
  };
}
