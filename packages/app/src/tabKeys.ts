/**
 * Tab switches between the Parts, Mixer and Song tabs (windsor#480), the way
 * Tab switches Ableton Live's Arrangement and Session views; Shift+Tab goes
 * the other way. Tab has that one job: the browser never moves focus with it.
 * `tabKeyAction` is the rule, pure and tested; `tabKeyFacts` reads the facts
 * off a DOM event, and `tabShell.ts` attaches the one listener.
 */
import { TAB_CYCLE } from './tabKeysConstants';

/** What a keydown carries that decides a tab switch. */
export interface TabKeyFacts {
  /** `KeyboardEvent.key`: `'Tab'` for the Tab key, with or without Shift. */
  readonly key: string;
  readonly shift: boolean;
  /** Auto-repeat from a held key. */
  readonly repeat: boolean;
  /** Ctrl, Meta or Alt is held: a shortcut of the system's or the browser's, not ours. */
  readonly modified: boolean;
  /** A modal dialog is open. */
  readonly inDialog: boolean;
}

/**
 * `switch` shows `tab` and swallows the key; `swallow` swallows it and does
 * nothing else (a held Tab's repeats, a Tab in a modal); `null` leaves the
 * key to the browser and the OS.
 */
export type TabKeyAction = { kind: 'switch'; tab: string } | { kind: 'swallow' } | null;

/** The tab after (or, with `back`, before) `active`; from outside the cycle, its first (or last). */
function nextTab(
  active: string | null,
  back: boolean,
  cycle: readonly string[] = TAB_CYCLE,
): string | null {
  const at = active === null ? -1 : cycle.indexOf(active);
  if (at < 0) return (back ? cycle[cycle.length - 1] : cycle[0]) ?? null;
  const step = back ? cycle.length - 1 : 1;
  return cycle[(at + step) % cycle.length] ?? null;
}

export function tabKeyAction(
  facts: TabKeyFacts,
  active: string | null,
  cycle: readonly string[] = TAB_CYCLE,
): TabKeyAction {
  if (facts.key !== 'Tab' || facts.modified) return null;
  if (facts.repeat || facts.inDialog) return { kind: 'swallow' };
  const tab = nextTab(active, facts.shift, cycle);
  return tab === null ? { kind: 'swallow' } : { kind: 'switch', tab };
}

/** The facts of a DOM keydown. Any open modal counts, wherever focus sits. */
export function tabKeyFacts(e: KeyboardEvent): TabKeyFacts {
  return {
    key: e.key,
    shift: e.shiftKey,
    repeat: e.repeat,
    modified: e.ctrlKey || e.metaKey || e.altKey,
    inDialog: document.querySelector('dialog:modal') !== null,
  };
}
