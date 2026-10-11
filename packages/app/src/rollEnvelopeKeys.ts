/**
 * E, D and S on the Roll's Envelopes tab (windsor#708 decision 6): they pick
 * the roll's tool while its Envelopes tab shows and no field has focus, as
 * the Song tab's keys pick its own (`wireToolKeys`). A key the roll takes
 * goes no further, so it never changes the Song tab's tool; and the Song
 * tab's keys write only the Song view's state, never the roll's.
 *
 * One window listener, in the capture phase so it runs before the Song
 * tab's, bound once and pointing at the device last drawn, as the roll
 * editor's Delete and Escape do (`rollEditor.ts`).
 */
import type { AutomationTool } from './songAutomationTables';
import { isFieldFocused, toolForKey } from './songAutomationToolbar';

/** The device the keys act on. */
export interface EnvelopeKeyTarget {
  /** Whether its Envelopes tab shows on the page now. */
  showing(): boolean;
  pick(tool: AutomationTool): void;
}

const KEYS: { target: EnvelopeKeyTarget | null } = { target: null };
let bound = false;

/** Whether the key is one the roll takes: E, D or S, plain, its Envelopes tab showing and no field focused. */
function takes(e: KeyboardEvent, target: EnvelopeKeyTarget | null): AutomationTool | null {
  const tool = toolForKey(e);
  if (!tool || !target || isFieldFocused(e) || !target.showing()) return null;
  return tool;
}

/** Point the keys at `target`, the device last drawn; the listener is bound on first use. */
export function envelopeKeys(target: EnvelopeKeyTarget): void {
  KEYS.target = target;
  if (bound) return;
  bound = true;
  window.addEventListener(
    'keydown',
    (e) => {
      const tool = takes(e, KEYS.target);
      if (!tool) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) KEYS.target?.pick(tool);
    },
    true,
  );
}
