/**
 * The full-pane patch browser's arrow keys between its columns (windsor#537,
 * the scope comment): Tab is the tab switch (`tabShell.ts`), so the arrows
 * are how a keyboard user walks the pane.
 *
 * - The results: ↑ ↓ move the selection and Enter loads (`patchBrowser.ts`);
 *   ← goes to the facets (the pressed one, else the first) and → to the info
 *   pane's first enabled button.
 * - The facets and the info pane's buttons: ↑ ↓ Home End move within the
 *   column (`patchMenuKeys.ts`); → from the facets and ← from the info pane
 *   go back to the results.
 * - The search field: → with the caret (or the selection) at the end goes
 *   to the results.
 */
import { moveMenuFocus } from './patchMenuKeys';

const RESULTS = '.pb-results';
const FACETS = '.pb-facets';
const INFO = '.pb-info';

function focusIn(pane: HTMLElement, selector: string): void {
  pane.querySelector<HTMLElement>(selector)?.focus();
}

/** The facets: the pressed facet (the filter's choice), else the first. */
function focusFacets(pane: HTMLElement): void {
  const pressed = pane.querySelector<HTMLElement>(`${FACETS} button[aria-pressed="true"]`);
  (pressed ?? pane.querySelector<HTMLElement>(`${FACETS} button`))?.focus();
}

/** Walk the buttons of the column `target` sits in; true when the key was handled. */
function walkColumn(pane: HTMLElement, column: string, event: KeyboardEvent): boolean {
  const buttons = [...pane.querySelectorAll<HTMLButtonElement>(`${column} button`)];
  if (moveMenuFocus(buttons, event)) return true;
  const across = column === FACETS ? 'ArrowRight' : 'ArrowLeft';
  if (event.key !== across) return false;
  event.preventDefault();
  focusIn(pane, RESULTS);
  return true;
}

function fromResults(pane: HTMLElement, event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') focusFacets(pane);
  else if (event.key === 'ArrowRight') focusIn(pane, `${INFO} button:not(:disabled)`);
  else return;
  event.preventDefault();
}

function fromSearch(pane: HTMLElement, input: HTMLInputElement, event: KeyboardEvent): void {
  // At the end of the text, or with the text selected to its end (as it opens).
  if (event.key !== 'ArrowRight' || input.selectionEnd !== input.value.length) return;
  event.preventDefault();
  focusIn(pane, RESULTS);
}

/** The pane's one keydown listener, under the results' and the search's own keys. */
export function paneKeys(pane: HTMLElement, event: KeyboardEvent): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.matches(RESULTS)) return fromResults(pane, event);
  if (target instanceof HTMLInputElement && target.type === 'search')
    return fromSearch(pane, target, event);
  if (!(target instanceof HTMLButtonElement)) return;
  if (target.closest(FACETS)) walkColumn(pane, FACETS, event);
  else if (target.closest(INFO)) walkColumn(pane, INFO, event);
}
