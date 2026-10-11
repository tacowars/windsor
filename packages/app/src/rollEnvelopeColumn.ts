/**
 * The Envelopes tab's controls column (windsor#707 decision 4; the approved
 * mockup's `.renv-ctl`), in the width the note controls had: the roll's
 * Snap, which the device moves in from the Notes column, and the picker
 * beside it; under them the shown envelope's section, then its switch and
 * ✕ with the counts; then Edit, Draw and Shape across both columns, and the
 * tool's hint. Here the tools only select (windsor#708 makes them act).
 * They look like the Song tab's (`.seg.auto-tools`, `.auto-hint`) under
 * their own classes, which the Song tab's tool sync never reaches.
 */
import type { RollEnvelope } from '@windsor/engine';
import { el } from './dom';
import type { EnvelopePicker } from './rollEnvelopePicker';
import {
  ROLL_ENVELOPE_HINTS,
  ROLL_ENVELOPE_TEXT as T,
  envCountText,
  voiceCountText,
} from './rollEnvelopeTables';
import { AUTOMATION_TOOLS, type AutomationTool } from './songAutomationTables';

/** What the column shows. */
export interface EnvelopeColumnState {
  readonly picker: EnvelopePicker;
  readonly shown: RollEnvelope | null;
  /** The shown envelope's target, named, and its section. */
  readonly name: string;
  readonly section: string;
  readonly tool: AutomationTool;
  readonly listOpen: boolean;
}

/** What its controls do. */
export interface EnvelopeColumnActions {
  /** Open or close the picker's list under `anchor`. */
  toggleList(anchor: HTMLElement): void;
  switchShown(): void;
  deleteShown(): void;
  pickTool(tool: AutomationTool): void;
}

function button(className: string, text: string): HTMLButtonElement {
  const node = el('button', className, text) as HTMLButtonElement;
  node.type = 'button';
  return node;
}

/** The picker's button: the shown envelope's chip and name, or "Pick target". */
function pickButton(state: EnvelopeColumnState, actions: EnvelopeColumnActions): HTMLElement {
  const { shown } = state;
  const pick = button(`renv-pick${shown ? '' : ' none'}`, '');
  pick.setAttribute('aria-haspopup', 'listbox');
  pick.setAttribute('aria-expanded', String(state.listOpen));
  pick.title = T.pickTitle;
  if (shown) {
    const chip = el('span', `auto-chip${shown.on ? '' : ' off'}`);
    pick.append(chip, el('span', 'nm', state.name));
  } else {
    pick.appendChild(el('span', 'nm', T.pick));
  }
  pick.onclick = () => actions.toggleList(pick);
  const item = el('div', 'roll-item');
  item.append(el('span', 'field-label', T.envelope), pick);
  return item;
}

/** The shown envelope's ● and ✕, then the two counts. */
function switchRow(state: EnvelopeColumnState, actions: EnvelopeColumnActions): HTMLElement {
  const row = el('div', 'renv-row');
  const { shown, picker } = state;
  if (shown) {
    const on = button(`auto-btn${shown.on ? ' on' : ''}`, '●');
    on.setAttribute('aria-pressed', String(shown.on));
    on.setAttribute('aria-label', `${state.name} envelope on`);
    on.title = shown.on ? T.offTitle : T.onTitle;
    on.onclick = () => actions.switchShown();
    const del = button('auto-btn', '×');
    del.setAttribute('aria-label', `Delete the ${state.name} envelope`);
    del.title = T.deleteTitle;
    del.onclick = () => actions.deleteShown();
    row.append(on, del);
  }
  const count = el('span', 'auto-count');
  count.append(
    el('span', '', envCountText(picker.envelopes, picker.envelopesMax)),
    el('br'),
    el('span', '', voiceCountText(picker.slots, picker.slotsMax)),
  );
  row.appendChild(count);
  return row;
}

/** Edit, Draw and Shape, as the Song tab's tools, with the picked one's hint under them. */
function tools(state: EnvelopeColumnState, actions: EnvelopeColumnActions): HTMLElement[] {
  const group = el('div', 'seg renv-tools');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', T.tool);
  for (const entry of AUTOMATION_TOOLS) {
    const pick = button('', entry.label);
    pick.dataset['tool'] = entry.tool;
    pick.title = `${entry.label} (${entry.key.toUpperCase()})`;
    pick.setAttribute('aria-pressed', String(entry.tool === state.tool));
    pick.onclick = () => actions.pickTool(entry.tool);
    group.appendChild(pick);
  }
  const item = el('div', 'roll-item renv-span');
  item.append(el('span', 'field-label', T.tool), group);
  return [item, el('p', 'renv-hint renv-span', ROLL_ENVELOPE_HINTS[state.tool])];
}

/** The column; `render` redraws all but the Snap the device keeps first in it. */
export function envelopeColumn(): {
  readonly root: HTMLElement;
  render(state: EnvelopeColumnState, actions: EnvelopeColumnActions): void;
} {
  const root = el('div', 'renv-ctl');
  root.hidden = true;
  return {
    root,
    render: (state, actions) => {
      const snap = root.querySelector(':scope > .roll-item.roll-snap');
      const at = el('div', 'renv-at');
      if (state.shown) at.appendChild(el('span', 'renv-kind', state.section));
      root.replaceChildren(
        ...(snap ? [snap] : []),
        pickButton(state, actions),
        at,
        switchRow(state, actions),
        ...tools(state, actions),
      );
    },
  };
}
