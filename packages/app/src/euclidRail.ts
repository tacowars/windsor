/**
 * The Euclid device's own rail buttons (windsor#356, decision 1 of the
 * issue): the lane-view toggle (own length above, under the hits below) and
 * a **?** whose title is the card's hint. Since windsor#368 the rail itself
 * is every sequencer device's (`sequencerRail.ts`: the dot, the name, the
 * region, Split and Delete); the Euclid card hands these buttons to it, to
 * sit between its name and the region.
 */
import { el } from './dom';
import { EUCLID_HINT } from './euclidConstants';
import type { LaneView } from './euclidLaneView';
import { railIcon, railSvg } from './sequencerRail';

/** Each view's button: its label and its 12 px icon. */
const VIEW_BUTTONS: readonly { view: LaneView; label: string; icon: string }[] = [
  {
    view: 'own',
    label: 'Lanes at their own length',
    icon: '<path d="M1 2.5h10M1 6h5M1 9.5h7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
  {
    view: 'hits',
    label: 'Lanes under the hits',
    icon:
      '<path d="M1 2.5h10M1 6h10M1 9.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M6.5 4.5v3" stroke="currentColor" stroke-width="1.2"/>',
  },
];

/** The lane-view toggle: two stacked buttons, the shown view pressed; a press calls `pick`. */
function viewToggle(shown: LaneView, pick: (view: LaneView) => void): HTMLElement {
  const group = el('div', 'seq-rail-group');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Lane view');
  for (const { view, label, icon } of VIEW_BUTTONS) {
    const button = railIcon(label);
    button.dataset.view = view;
    button.setAttribute('aria-pressed', String(view === shown));
    button.appendChild(railSvg(icon));
    button.onclick = (): void => {
      group.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === button));
      });
      pick(view);
    };
    group.appendChild(button);
  }
  return group;
}

/** The Euclid card's rail buttons, its lane view `shown`: the toggle, then the **?**. */
export function euclidRailTools(
  shown: LaneView,
  pick: (view: LaneView) => void,
): readonly HTMLElement[] {
  const help = railIcon(EUCLID_HINT);
  help.setAttribute('aria-label', 'How this works');
  help.textContent = '?';
  return [viewToggle(shown, pick), help];
}
