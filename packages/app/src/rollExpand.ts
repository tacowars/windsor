/**
 * Expand (windsor#602 decision 9; record
 * `2026-10-17-expanded-views-below-the-header`): the Roll device, rail and
 * all, opened wide on the console's expanded-view ground below the header
 * (`expandedViewFrame.ts`), so the transport, undo and the tabs stay live.
 * The device itself moves into the view, so its rail's Split and Delete are
 * still the pane's, and a stand-in keeps its place in the pane's row: the
 * rail drawn inert beside a note that the roll is open wide. Esc while the
 * view is on screen, or the rail's button, closes it and puts the device
 * back.
 *
 * Whether a part's roll is expanded is the session's, by slot, so a pane
 * repaint under the view (a Split from its rail) opens the new device
 * expanded, and it takes over from the old one. When the pane under the view
 * changes to another part, the view stays open on its own part (decision 6);
 * it goes only once its region no longer holds a Roll.
 */
import type { AppCtx } from './context';
import { el } from './dom';
import { type ExpandedFrame, mountExpandedView } from './expandedViewFrame';
import { SEQUENCER_DEVICE_PX } from './sequencerDeviceTables';
import { railIcon, railSvg } from './sequencerRail';

const ICON_EXPAND = '<path d="M7 1.5h3.5V5M10.5 1.5 6.8 5.2M5 10.5H1.5V7M1.5 10.5l3.7-3.7"/>';
const ICON_COLLAPSE =
  '<path d="M6.8 1.8v3.4h3.4M10.5 1.5 6.8 5.2M5.2 10.2V6.8H1.8M1.5 10.5l3.7-3.7"/>';

/** The parts whose roll is open wide, by slot. */
const EXPANDED = new Set<number>();

/** What Expand needs of its card. */
export interface ExpandTarget {
  readonly ctx: Pick<AppCtx, 'onTabShown'>;
  readonly slot: number;
  /** The card's body, inside the device it moves. */
  readonly body: HTMLElement;
  /** The overlay's title: `Keys I — Roll`. */
  title(): string;
  /** Whether the region the card edits still holds a Roll: the view closes once it does not. */
  holds(): boolean;
  /** After the view changes, to redraw at the other view's zoom and size. */
  changed(expanded: boolean): void;
}

/** One card's Expand: its rail button, and the overlay it opens. */
export interface RollExpander {
  readonly button: HTMLButtonElement;
  isExpanded(): boolean;
  /** Open wide if the part was left open wide; on the card's first frame, once it is in a device. */
  restore(): void;
  /** False once the card has left the page; closes a view whose Roll is gone on the way. */
  attached(): boolean;
}

function setIcon(button: HTMLButtonElement, expanded: boolean): void {
  const label = expanded ? 'Close the wide view (Esc)' : 'Expand: open the roll wide';
  button.title = label;
  button.setAttribute('aria-label', expanded ? 'Close wide view' : 'Expand');
  button.replaceChildren(railSvg(expanded ? ICON_COLLAPSE : ICON_EXPAND));
}

function standInFor(device: HTMLElement): HTMLElement {
  const standIn = device.cloneNode(false) as HTMLElement;
  const rail = device.querySelector('.seq-rail')?.cloneNode(true);
  if (rail instanceof HTMLElement) {
    rail.inert = true;
    standIn.appendChild(rail);
  }
  standIn.appendChild(el('div', 'roll-placeholder', 'Open wide — editing in the expanded view'));
  return standIn;
}

/** The view's ground and its head; the device follows the head. */
function overlayFor(title: string): HTMLElement {
  const overlay = el('div', 'roll-overlay');
  for (const [prop, px] of Object.entries(SEQUENCER_DEVICE_PX)) {
    overlay.style.setProperty(prop, `${px}px`);
  }
  const head = el('div', 'roll-overlay-head');
  head.append(
    el('span', 'roll-overlay-title', title),
    el('span', 'roll-overlay-note', 'Expanded · Esc closes'),
  );
  overlay.append(head);
  return overlay;
}

/** Expand for one Roll card. */
export function rollExpander(target: ExpandTarget): RollExpander {
  const button = railIcon('Expand', 'seq-icon seq-line-icon roll-expand');
  let open: { device: HTMLElement; standIn: HTMLElement; frame: ExpandedFrame } | null = null;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && open?.frame.shown()) {
      e.preventDefault();
      close();
    }
  };
  /** Close the view: the device goes back into the pane when its stand-in is still there. */
  function close(): void {
    if (!open) return;
    const { device, standIn, frame } = open;
    open = null;
    document.removeEventListener('keydown', onKey);
    EXPANDED.delete(target.slot);
    setIcon(button, false);
    const back = standIn.isConnected;
    if (back) standIn.replaceWith(device);
    frame.remove();
    if (back) target.changed(false);
  }
  function expand(): void {
    const device = target.body.closest<HTMLElement>('.seq-device');
    if (open || !device) return;
    const overlay = overlayFor(target.title());
    // Mounted while the device is still in its tab, which the view then belongs to.
    const frame = mountExpandedView({ ctx: target.ctx, overlay, from: device, close });
    const standIn = standInFor(device);
    device.replaceWith(standIn);
    overlay.appendChild(device);
    open = { device, standIn, frame };
    document.addEventListener('keydown', onKey);
    // After the mount, whose closing of an older view of this part cleared the slot.
    EXPANDED.add(target.slot);
    setIcon(button, true);
    target.changed(true);
  }
  const wasExpanded = EXPANDED.has(target.slot);
  setIcon(button, false);
  button.onclick = (): void => (open ? close() : expand());
  return {
    button,
    isExpanded: () => open !== null,
    restore: () => {
      if (wasExpanded && !open) expand();
    },
    attached: () => {
      if (!open) return target.body.isConnected;
      if (open.standIn.isConnected || target.holds()) return true;
      close();
      return false;
    },
  };
}
