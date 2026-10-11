/**
 * The Roll card's tab row (windsor#707 decision 2; the approved mockup
 * `docs/design/roll-envelopes-mockup.html`): Notes · Envelopes, drawn as the
 * Figure card's tabs, and the summary at its right. The page a press picks
 * is the view's (`rollView.ts`), never the song's; the device hears it
 * through `onPick`.
 */
import { el } from './dom';
import { ROLL_PAGES, type RollPage } from './rollEnvelopeTables';

/** The row, its summary, and the pressed tab's sync. */
export interface RollTabs {
  readonly row: HTMLElement;
  readonly summary: HTMLElement;
  /** Show `page` as the selected tab. */
  show(page: RollPage): void;
  /** What a press on a tab does; set by the device once it is built. */
  onPick: (page: RollPage) => void;
}

/** The tab row: a button per page, then the summary. */
export function rollTabs(): RollTabs {
  const row = el('div', 'roll-tabs');
  row.setAttribute('role', 'tablist');
  row.setAttribute('aria-label', 'Roll pages');
  const summary = el('span', 'roll-summary');
  const tabs: RollTabs = {
    row,
    summary,
    show: (page) => {
      for (const button of buttons) {
        button.setAttribute('aria-selected', String(button.dataset['page'] === page));
      }
    },
    onPick: () => undefined,
  };
  const buttons = ROLL_PAGES.map(({ page, label }) => {
    const button = el('button', '', label) as HTMLButtonElement;
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.dataset['page'] = page;
    button.onclick = () => tabs.onPick(page);
    return button;
  });
  row.append(...buttons, summary);
  tabs.show('notes');
  return tabs;
}
