/**
 * Where an expanded view sits (record `2026-10-17-expanded-views-below-the-header`):
 * in the tab root, below the console header, filling what the header leaves
 * of the window (`.roll-overlay` in `console.css`), so the transport, undo
 * and redo, the tabs and the part chips stay live above it. It shows only
 * while the tab its card lives on is shown (`AppCtx.onTabShown`), and the
 * console's one `ExpandedViews` keeps a single view open.
 *
 * While a view is on screen the console stops at the window's foot, so the
 * page cannot scroll under it; its close puts the page back where it was.
 */
import type { AppCtx } from './context';
import { type ExpandedView, ExpandedViews } from './expandedViews';

/** The console's expanded views: one open at a time. */
const VIEWS = new ExpandedViews<ExpandedView>();

/** A mounted view's frame. */
export interface ExpandedFrame {
  /** Open with its tab shown: its keys act only then. */
  shown(): boolean;
  /** Take the overlay down and out of the rules. */
  remove(): void;
}

/** What the frame needs to mount a view. */
export interface ExpandedMount {
  readonly ctx: Pick<AppCtx, 'onTabShown'>;
  /** The view's ground, a `.roll-overlay`. */
  readonly overlay: HTMLElement;
  /** An element of the card that opens it: the view belongs to that card's tab. */
  readonly from: HTMLElement;
  /** The view's own close, which another view's opening calls. */
  close(): void;
}

/** Mount a view below the header, closing the view open before it. */
export function mountExpandedView(mount: ExpandedMount): ExpandedFrame {
  const { overlay } = mount;
  const tab = mount.from.closest<HTMLElement>('.tab-panel')?.dataset.tab;
  const view: ExpandedView = { close: () => mount.close() };
  VIEWS.opened(view);
  // Read after the view before it closed and gave the page its scroll back.
  const scrollY = window.scrollY;
  (document.getElementById('tabRoot') ?? document.body).appendChild(overlay);
  const stop =
    tab === undefined
      ? (): void => {}
      : mount.ctx.onTabShown(tab, (shown) => {
          overlay.hidden = !shown;
          VIEWS.tabShown(view, shown);
        });
  return {
    shown: () => VIEWS.shown(view),
    remove: () => {
      const shown = VIEWS.shown(view);
      stop();
      VIEWS.closed(view);
      overlay.remove();
      // Closed on another tab (another view opened there): that tab's page keeps its own scroll.
      if (shown) window.scrollTo({ top: scrollY });
    },
  };
}
