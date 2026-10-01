/**
 * The Euclid card's rail (windsor#356, decision 1 of the issue): the left
 * edge as the insert rack draws one (`.insert-rail`), copied under Euclid
 * class names. Top down: the part's accent dot, the vertical name ("Euclid"
 * and the part's name), then at the foot the lane-view toggle (own length
 * above, under the hits below) and a **?** whose title is the card's hint.
 */
import { el, html } from './dom';
import { EUCLID_HINT } from './euclidConstants';
import type { LaneView } from './euclidLaneView';

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

function railButton(label: string, className = 'euclid-icon'): HTMLButtonElement {
  const button = el('button', className) as HTMLButtonElement;
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

/** The lane-view toggle: two stacked buttons, the shown view pressed; a press calls `pick`. */
function viewToggle(shown: LaneView, pick: (view: LaneView) => void): HTMLElement {
  const group = el('div', 'euclid-rail-group');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Lane view');
  for (const { view, label, icon } of VIEW_BUTTONS) {
    const button = railButton(label);
    button.dataset.view = view;
    button.setAttribute('aria-pressed', String(view === shown));
    button.appendChild(
      html('span', 'euclid-icon-svg', `<svg viewBox="0 0 12 12" aria-hidden="true">${icon}</svg>`),
    );
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

/** The rail for the part named `partName`, its lane view `shown`. */
export function euclidRail(
  partName: string,
  shown: LaneView,
  pick: (view: LaneView) => void,
): HTMLElement {
  const rail = el('div', 'euclid-rail');
  const dot = el('span', 'euclid-dot');
  dot.setAttribute('aria-hidden', 'true');
  const name = el('span', 'euclid-name', 'Euclid');
  name.appendChild(el('span', 'euclid-name-part', partName));
  const help = railButton(EUCLID_HINT);
  help.setAttribute('aria-label', 'How this works');
  help.textContent = '?';
  rail.append(dot, name, el('span', 'euclid-rail-spacer'), viewToggle(shown, pick), help);
  return rail;
}
