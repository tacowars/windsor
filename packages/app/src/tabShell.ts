/**
 * The tab bar and its panels (#70): one button and one panel per tab,
 * registered with the context, which decides what renders when (#620
 * decision 2). `main.ts` hands this the tab list and the two mount points.
 */
import type { AppContext } from './appContext';
import { el } from './dom';

export interface TabSpec {
  id: string;
  label: string;
  render: (body: HTMLElement) => void;
}

export function mountTabShell(
  ctx: AppContext<HTMLElement>,
  tabs: readonly TabSpec[],
  bar: HTMLElement,
  root: HTMLElement,
): void {
  const buttons: HTMLButtonElement[] = [];
  const syncPressed = (): void => {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.tab === ctx.activeTab));
    }
  };
  for (const tab of tabs) {
    const button = el('button', 'tab-btn', tab.label) as HTMLButtonElement;
    button.type = 'button';
    button.dataset.tab = tab.id;
    button.onclick = (): void => {
      ctx.activate(tab.id);
      syncPressed();
    };
    buttons.push(button);
    bar.appendChild(button);
    const panel = el('div', 'tab-panel');
    ctx.addTab(tab.id, panel, tab.render);
    root.appendChild(panel);
  }
  syncPressed();
}
