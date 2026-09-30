/**
 * The tab bar and its panels (#70): one button and one panel per tab,
 * registered with the context, which decides what renders when (#620
 * decision 2). `main.ts` hands this the tab list and the two mount points.
 * A tab may show an icon in place of its label (windsor#39): its name is then
 * the button's accessible name and its tooltip.
 * The pressed button follows the shown tab however it was shown: a click, or
 * an undo or a redo that shows its step's tab (windsor#163).
 */
import type { AppContext, TabPanel } from './appContext';
import { el, html } from './dom';

export interface TabSpec {
  /** The id the context registers and remembers; never shown. */
  id: string;
  /** The button's text, or its accessible name when `icon` is set. */
  label: string;
  /** Inline SVG markup drawn instead of `label`; it inherits the button's colour. */
  icon?: string;
  /** The accessible name and tooltip for an icon tab; defaults to `label`. */
  ariaLabel?: string;
  render: (body: HTMLElement) => void;
}

/** What a tab's button shows: its text, or an icon with a name to announce. */
export type TabFace =
  { kind: 'text'; text: string } | { kind: 'icon'; markup: string; name: string };

/**
 * The settings gear (windsor#39), stroked in `currentColor` so it follows the
 * tab's colour. The path is Feather Icons' `settings` icon (MIT, © Cole Bemis,
 * github.com/feathericons/feather), which is AGPL-compatible.
 */
export const GEAR_ICON =
  '<svg class="tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
  'aria-hidden="true" focusable="false">' +
  '<circle cx="12" cy="12" r="3"/>' +
  '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 ' +
  '1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 ' +
  '1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 ' +
  '4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 ' +
  '1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06' +
  'A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
  '</svg>';

export function tabFace(tab: Pick<TabSpec, 'label' | 'icon' | 'ariaLabel'>): TabFace {
  if (tab.icon === undefined) return { kind: 'text', text: tab.label };
  return { kind: 'icon', markup: tab.icon, name: tab.ariaLabel ?? tab.label };
}

/** Whether a tab's button reads as pressed: only the shown tab's does. */
export function isPressed(tabId: string | undefined, activeTab: string | null): boolean {
  return tabId !== undefined && tabId === activeTab;
}

/** The part of the context the pressed state follows: the shown tab and its chrome renders. */
export type PressedSyncContext = Pick<AppContext<TabPanel>, 'activeTab' | 'addChrome'>;

/**
 * Keeps each tab's pressed state on the shown tab (windsor#163). It registers
 * a chrome render, because undo and redo show a tab and then run every chrome
 * render; a click shows its tab without one and calls the returned sync
 * itself. `setPressed` sets one tab's pressed state, which keeps this off the DOM.
 */
export function followShownTab(
  ctx: PressedSyncContext,
  tabIds: readonly string[],
  setPressed: (tabId: string, pressed: boolean) => void,
): () => void {
  const sync = (): void => {
    for (const tabId of tabIds) setPressed(tabId, isPressed(tabId, ctx.activeTab));
  };
  ctx.addChrome(sync);
  sync();
  return sync;
}

function tabButton(tab: TabSpec): HTMLButtonElement {
  const face = tabFace(tab);
  if (face.kind === 'text') return el('button', 'tab-btn', face.text) as HTMLButtonElement;
  const button = html('button', 'tab-btn tab-btn-icon', face.markup) as HTMLButtonElement;
  button.setAttribute('aria-label', face.name);
  button.title = face.name;
  return button;
}

export function mountTabShell(
  ctx: AppContext<HTMLElement>,
  tabs: readonly TabSpec[],
  bar: HTMLElement,
  root: HTMLElement,
): void {
  const buttons = new Map<string, HTMLButtonElement>();
  let syncPressed = (): void => {};
  for (const tab of tabs) {
    const button = tabButton(tab);
    button.type = 'button';
    button.dataset.tab = tab.id;
    button.onclick = (): void => {
      ctx.activate(tab.id);
      syncPressed();
    };
    buttons.set(tab.id, button);
    bar.appendChild(button);
    const panel = el('div', 'tab-panel');
    ctx.addTab(tab.id, panel, tab.render);
    root.appendChild(panel);
  }
  syncPressed = followShownTab(ctx, [...buttons.keys()], (tabId, pressed) => {
    buttons.get(tabId)?.setAttribute('aria-pressed', String(pressed));
  });
}
