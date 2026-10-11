/**
 * The Envelopes tab's controls column (windsor#707 decision 4; the approved
 * mockup's `.renv-ctl`), in the width the note controls had: the roll's
 * Snap, which the device moves in from the Notes column, and the picker
 * beside it; under them the shown envelope's section, then its switch and
 * ✕ with the counts; then Edit, Draw and Shape across both columns, and the
 * tool's hint. The tools act through `rollEnvelopeEditing.ts`
 * (windsor#708). They look like the Song tab's (`.seg.auto-tools`,
 * `.auto-hint`) under their own classes, which the Song tab's tool sync
 * never reaches. Under the section, the envelope's value under the
 * pointer, as the mockup's state 3 shows it. A gesture refused on a full
 * envelope puts "Envelope full" in the hint's place until the next one
 * (windsor#724 decision 1).
 */
import type { RollEnvelope } from '@windsor/engine';
import { ROLL_ENVELOPE_POINTS_MAX } from '@windsor/engine';
import { el } from './dom';
import type { EnvelopePicker } from './rollEnvelopePicker';
import {
  ROLL_ENVELOPE_HINTS,
  ROLL_ENVELOPE_TEXT as T,
  envCountText,
  envelopeFullText,
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
  /** The last gesture was refused: the envelope's heard points fill the cap. */
  readonly full: boolean;
}

/** The hint under the tools: the tool's, or the refusal's while `full`. */
export const envelopeHint = (
  state: Pick<EnvelopeColumnState, 'tool' | 'full'>,
  max = ROLL_ENVELOPE_POINTS_MAX,
): string => (state.full ? envelopeFullText(max) : ROLL_ENVELOPE_HINTS[state.tool]);

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
  return [item, el('p', 'renv-hint renv-span', envelopeHint(state))];
}

/** The column; `render` redraws all but the Snap the device keeps first in it. */
export function envelopeColumn(): {
  readonly root: HTMLElement;
  render(state: EnvelopeColumnState, actions: EnvelopeColumnActions): void;
  /** The shown envelope's value under the pointer, or null to clear it. */
  value(text: string | null): void;
} {
  const root = el('div', 'renv-ctl');
  root.hidden = true;
  const value = el('span', 'renv-val');
  return {
    root,
    value: (text) => {
      value.textContent = text ?? '';
    },
    render: (state, actions) => {
      const snap = root.querySelector(':scope > .roll-item.roll-snap');
      const at = el('div', 'renv-at');
      if (state.shown) {
        value.classList.toggle('off', !state.shown.on);
        at.append(el('span', 'renv-kind', state.section), value);
      }
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
