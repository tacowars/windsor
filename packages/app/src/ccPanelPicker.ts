/**
 * "+ Add mapping"'s target list (windsor#784, the mockup's `.cc-list`, drawn
 * as the Roll's envelope picker list): a head with the part's voice count
 * against eight, hot once full, then the groups of `ccTargetList`. A pick
 * goes straight into learn, which the panel starts.
 */
import type { CcTargetId } from '@windsor/engine';

import { type CcTargetList, ccVoiceCount } from './ccPanelTargets';
import { el } from './dom';

/** The list for `list`; `onPick` hears the target picked. */
export function ccTargetPicker(
  list: CcTargetList,
  onPick: (target: CcTargetId) => void,
): HTMLElement {
  const box = el('div', 'cc-list');
  box.setAttribute('role', 'listbox');
  box.setAttribute('aria-label', 'Add a mapping');
  const head = el('div', 'cc-list-head');
  const count = el('span', 'auto-count', ccVoiceCount(list.used, list.max));
  count.classList.toggle('full', list.full);
  head.append(el('span', '', 'Add a mapping'), count);
  box.append(head);
  for (const group of list.groups) {
    box.append(el('div', 'cc-group', group.label));
    for (const option of group.options) {
      const pick = el('button', 'cc-opt') as HTMLButtonElement;
      pick.type = 'button';
      pick.setAttribute('role', 'option');
      pick.append(el('span', 'nm', option.label));
      if (option.tag) pick.append(el('span', 'tag', option.tag));
      pick.disabled = option.refused !== null;
      if (option.refused) pick.title = option.refused;
      pick.onclick = (): void => onPick(option.target);
      box.append(pick);
    }
  }
  return box;
}
