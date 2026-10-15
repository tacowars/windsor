/**
 * The lane toolbar (windsor#349 decisions 1 and 6; the mockup
 * `docs/design/automation-lanes-mockup.html`): above the Song lanes while any
 * part is folded open, the Edit, Draw and Shape tools, the Snap select and the
 * tool's hint. The tool and the snap are the host's tool state
 * (`automationEditHost.ts`, windsor#706): on the Song tab the view's, kept
 * for the session and never written to the document.
 *
 * The tools are picked by their buttons alone: the E, D and S keys of
 * windsor#349 decision 6 are retired, and S is the Song tab's solo
 * (record `2026-10-15-song-tab-mute-solo-keys`).
 */
import { TICKS_PER_BAR } from '@windsor/engine';
import type { AutomationToolState } from './automationEditHost';
import { el } from './dom';
import { AUTOMATION_TOOLS, snapChoices } from './songAutomationTables';

const FIELD_TAGS: ReadonlySet<string> = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

/** Whether a key event belongs to a field (an input, a select, a text area, an editable) or an open dialog. */
export function isFieldFocused(e: Event): boolean {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return false;
  if (FIELD_TAGS.has(target.tagName) || target.isContentEditable) return true;
  return target.closest('dialog[open]') !== null;
}

/** Show `state`'s tool: the pressed button, the hint, and the lanes' cursor. */
export function syncAutomationTool(root: ParentNode, state: AutomationToolState): void {
  for (const button of root.querySelectorAll<HTMLElement>('.auto-tools button')) {
    button.setAttribute('aria-pressed', String(button.dataset['tool'] === state.automationTool));
  }
  const hint = root.querySelector('.auto-hint');
  const entry = AUTOMATION_TOOLS.find((t) => t.tool === state.automationTool);
  if (hint && entry) hint.textContent = entry.hint;
  const lanes = root.querySelector<HTMLElement>('.lanes');
  if (lanes) lanes.dataset['autoTool'] = state.automationTool;
}

/**
 * The toolbar's element; `root` is what `syncAutomationTool` updates when a
 * tool is picked, and `onPick` hears the pick (the Shape popover closes on
 * another tool, windsor#350). Snap's Bar is the song's bar, `barTicks` (windsor#430).
 */
export function automationToolbar(
  state: AutomationToolState,
  root: () => ParentNode,
  onPick: () => void = () => undefined,
  barTicks: number = TICKS_PER_BAR,
): HTMLElement {
  const bar = el('div', 'auto-toolbar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Automation tools');
  const tools = el('div', 'seg auto-tools');
  tools.setAttribute('role', 'group');
  tools.setAttribute('aria-label', 'Tool');
  for (const entry of AUTOMATION_TOOLS) {
    const button = el('button', '', entry.label) as HTMLButtonElement;
    button.type = 'button';
    button.dataset['tool'] = entry.tool;
    button.title = entry.label;
    button.onclick = (): void => {
      state.automationTool = entry.tool;
      syncAutomationTool(root(), state);
      onPick();
    };
    tools.appendChild(button);
  }
  const snap = document.createElement('select');
  snap.className = 'field compact auto-snap';
  snap.name = 'automation-snap';
  snap.id = 'automation-snap';
  const choices = snapChoices(barTicks);
  // A grain no choice holds is the Bar of the meter the song had: it follows the song's bar.
  if (!choices.some((c) => c.ticks === state.automationSnap)) state.automationSnap = barTicks;
  for (const choice of choices) snap.add(new Option(choice.label, String(choice.ticks)));
  snap.value = String(state.automationSnap);
  snap.onchange = (): void => {
    state.automationSnap = Number(snap.value);
  };
  const snapLabel = el('label', 'auto-tlabel', 'Snap') as HTMLLabelElement;
  snapLabel.htmlFor = snap.id;
  const group = (...nodes: HTMLElement[]): HTMLElement => {
    const box = el('div', 'auto-tgroup');
    box.append(...nodes);
    return box;
  };
  bar.append(
    group(el('span', 'auto-tlabel', 'Tool'), tools),
    group(snapLabel, snap),
    el('span', 'auto-hint'),
  );
  return bar;
}
