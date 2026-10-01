/**
 * The Euclid card's page tabs (windsor#356, decision 2 of the issue): the
 * row an insert with two or more pages draws (`.insert-tabs`), copied under
 * Euclid class names, the selected tab filled in the part's accent. Pattern
 * and Density, and at the row's right end the modulator in one line, so `k`
 * can be watched from either page. A press shows its page and hides the
 * other; the shown page is the session's (`euclidCardState.ts`).
 */
import { el } from './dom';
import type { EuclidPage } from './euclidCardState';

const PAGES: readonly { page: EuclidPage; label: string }[] = [
  { page: 'pattern', label: 'Pattern' },
  { page: 'density', label: 'Density' },
];

/** The tab row and the note at its end, which the card's loop keeps current. */
export interface EuclidTabs {
  readonly row: HTMLElement;
  readonly note: HTMLElement;
}

/**
 * The tabs over `pages`, `shown` selected; a press shows that page and calls
 * `picked` with it.
 */
export function euclidTabs(
  pages: Readonly<Record<EuclidPage, HTMLElement>>,
  shown: EuclidPage,
  picked: (page: EuclidPage) => void,
): EuclidTabs {
  const row = el('div', 'euclid-tabs');
  row.setAttribute('role', 'tablist');
  row.setAttribute('aria-label', 'Euclid pages');
  const show = (page: EuclidPage): void => {
    row.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.page === page));
    });
    for (const { page: other } of PAGES) pages[other].hidden = other !== page;
  };
  for (const { page, label } of PAGES) {
    const tab = el('button', '', label) as HTMLButtonElement;
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.dataset.page = page;
    tab.onclick = (): void => {
      show(page);
      picked(page);
    };
    row.appendChild(tab);
    pages[page].setAttribute('role', 'tabpanel');
    pages[page].setAttribute('aria-label', label);
  }
  const note = el('span', 'euclid-tab-note');
  row.appendChild(note);
  show(shown);
  return { row, note };
}
