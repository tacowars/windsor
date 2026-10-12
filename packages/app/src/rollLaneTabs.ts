/**
 * The lane switch (windsor#754; record
 * `2026-10-12-roll-note-accent-and-ratchet` decision 7, the mockup's
 * `.lane-pick`): three stacked tabs, Vel · Acc · Rat, in the corner under
 * the keys, choosing what the lane under the notes shows. The choice is the
 * view's (`rollView.ts`), kept per part for the session, never the song's.
 */
import { el } from './dom';
import type { RollLane } from './rollMarks';
import { ROLL_LANES } from './rollTables';
import type { RollViewState } from './rollView';

/** Fill `corner` with the tabs; a pick sets `view.lane` and calls `changed`. */
export function rollLaneTabs(
  corner: HTMLElement,
  view: RollViewState,
  changed: () => void,
): { refresh(): void } {
  corner.setAttribute('role', 'tablist');
  corner.setAttribute('aria-label', 'Lane under the notes');
  const tabs = ROLL_LANES.map((lane) => {
    const tab = el('button', '', lane.label) as HTMLButtonElement;
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.title = lane.title;
    tab.dataset.lane = lane.id;
    tab.onclick = () => {
      if (view.lane === lane.id) return;
      view.lane = lane.id as RollLane;
      refresh();
      changed();
    };
    return tab;
  });
  const refresh = (): void => {
    for (const tab of tabs)
      tab.setAttribute('aria-selected', String(tab.dataset.lane === view.lane));
  };
  corner.replaceChildren(...tabs);
  refresh();
  return { refresh };
}
