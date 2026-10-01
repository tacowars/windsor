/**
 * The lane toolbar (windsor#349 decisions 1 and 6; the mockup
 * `docs/design/automation-lanes-mockup.html`): above the Song lanes while any
 * part is folded open, the Edit and Draw tools, the Snap select and the
 * tool's hint. The tool and the snap are the view's state, kept for the
 * session and never written to the document.
 *
 * E and D pick the tools while the Song tab shows the toolbar and no field
 * has focus. They take the key from the audition keyboard there, so a tool
 * switch never sounds a note.
 */
import { el } from './dom';
import {
  AUTOMATION_TOOLS,
  SNAP_CHOICES,
  type AutomationTool,
  type AutomationToolEntry,
} from './songAutomationTables';
import type { SongViewState } from './songTab';

const FIELD_TAGS: ReadonlySet<string> = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

/** Whether a key event belongs to a field (an input, a select, a text area, an editable) or an open dialog. */
export function isFieldFocused(e: Event): boolean {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return false;
  if (FIELD_TAGS.has(target.tagName) || target.isContentEditable) return true;
  return target.closest('dialog[open]') !== null;
}

/** The tool a key picks: a plain press of its letter, no modifier, no repeat. */
export function toolForKey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>,
  tools: readonly AutomationToolEntry[] = AUTOMATION_TOOLS,
): AutomationTool | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  return tools.find((t) => t.key === e.key.toLowerCase())?.tool ?? null;
}

/** Show `state`'s tool: the pressed button, the hint, and the lanes' cursor. */
export function syncAutomationTool(root: ParentNode, state: SongViewState): void {
  for (const button of root.querySelectorAll<HTMLElement>('.auto-tools button')) {
    button.setAttribute('aria-pressed', String(button.dataset['tool'] === state.automationTool));
  }
  const hint = root.querySelector('.auto-hint');
  const entry = AUTOMATION_TOOLS.find((t) => t.tool === state.automationTool);
  if (hint && entry) hint.textContent = entry.hint;
  const lanes = root.querySelector<HTMLElement>('.lanes');
  if (lanes) lanes.dataset['autoTool'] = state.automationTool;
}

/** The toolbar's element; `root` is what `syncAutomationTool` updates when a tool is picked. */
export function automationToolbar(state: SongViewState, root: () => ParentNode): HTMLElement {
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
    button.title = `${entry.label} (${entry.key.toUpperCase()})`;
    button.onclick = (): void => {
      state.automationTool = entry.tool;
      syncAutomationTool(root(), state);
    };
    tools.appendChild(button);
  }
  const snap = document.createElement('select');
  snap.className = 'field compact auto-snap';
  snap.name = 'automation-snap';
  snap.id = 'automation-snap';
  for (const choice of SNAP_CHOICES) snap.add(new Option(choice.label, String(choice.ticks)));
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

/**
 * E and D on the window, ahead of the audition keyboard: they pick a tool
 * while `body` is shown with its toolbar and no field has focus. Wired once
 * per tab, since the tab's body outlives its renders.
 */
export function wireToolKeys(body: HTMLElement, state: SongViewState): void {
  window.addEventListener(
    'keydown',
    (e) => {
      const tool = toolForKey(e);
      if (!tool || isFieldFocused(e) || body.closest('[hidden]') !== null) return;
      if (!body.querySelector('.auto-toolbar:not([hidden])')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      state.automationTool = tool;
      syncAutomationTool(body, state);
    },
    true,
  );
}
