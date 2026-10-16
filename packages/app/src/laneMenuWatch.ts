/**
 * The lane menu's document watch (windsor#827 decision 6, a carried fix from
 * windsor#826's review): an open lane menu closes on any change to the
 * document it was built for, through one `onChange` listener. That listener
 * must not outlive its menu, or every opening dismissed without an edit
 * (Escape, a press outside, a scroll, a key, Copy, Zoom) leaves its callback,
 * its view and its spec in the model's listener set until the next edit.
 *
 * So the lane keeps one watch at a time: opening a menu ends the watch
 * before it, running any row ends it (the menu has closed), and the first
 * change ends it as it closes the menu. Pure, so the count is tested in Node.
 */

/** Subscribe `listener` to the document's changes; returns the unsubscribe (`DocumentModel.onChange`). */
export type Subscribe = (listener: () => void) => () => void;

/** At most one menu's watch on the document. */
export class LaneMenuWatch {
  private off: (() => void) | null = null;

  /** Watch for the menu whose close is `close`: the watch before it ends, and the first change closes it. */
  start(subscribe: Subscribe, close: () => void): void {
    this.stop();
    const off = subscribe(() => {
      this.stop();
      close();
    });
    this.off = off;
  }

  /** End the watch, if one is on. */
  stop(): void {
    const off = this.off;
    this.off = null;
    off?.();
  }

  /** True while a menu is watched. */
  get watching(): boolean {
    return this.off !== null;
  }
}
