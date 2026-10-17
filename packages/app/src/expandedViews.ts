/**
 * The console's expanded views, the Roll's and Spectre's workbench (record
 * `2026-10-17-expanded-views-below-the-header`), as rules with no DOM:
 *
 * - One view is open at a time: opening one closes the one open before it.
 * - A view belongs to the tab its card lives on, and is on screen only while
 *   that tab is shown. Switching tabs never closes it: going back shows it
 *   still open.
 * - Its keys, Esc among them, act only while it is on screen, so Esc on
 *   another tab leaves it open.
 *
 * `expandedViewFrame.ts` holds the console's one instance and the DOM.
 */

/** One expanded view, as the rules see it. */
export interface ExpandedView {
  /** Take the view down, when another view opens. */
  close(): void;
}

/** Which view is open, and whether its tab is shown. */
export class ExpandedViews<V extends ExpandedView = ExpandedView> {
  private open: V | null = null;
  private onScreen = false;

  /**
   * `view` opens, on its own tab; the view open before it, if another, closes
   * first, while it is still the open one, so its close sees whether it was
   * on screen. Returns that view when it was on screen: `view` took over from
   * it on the same screen (a repaint under it), and inherits what it kept.
   */
  opened(view: V): V | null {
    const before = this.open;
    const wasShown = before !== null && before !== view && this.onScreen;
    if (before && before !== view) before.close();
    this.open = view;
    this.onScreen = true;
    return wasShown ? before : null;
  }

  /** `view` closed (its Close, Esc, or its subject gone); a view no longer open changes nothing. */
  closed(view: V): void {
    if (this.open === view) this.open = null;
  }

  /** `view`'s tab was shown or hidden. */
  tabShown(view: V, shown: boolean): void {
    if (this.open === view) this.onScreen = shown;
  }

  /** Whether `view` is open. */
  isOpen(view: V): boolean {
    return this.open === view;
  }

  /** Whether `view` is open with its tab shown: only then do its keys act. */
  shown(view: V): boolean {
    return this.open === view && this.onScreen;
  }
}
