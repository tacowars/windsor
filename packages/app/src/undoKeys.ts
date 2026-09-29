/**
 * The undo and redo keys (windsor#131, epic windsor#112 decision 8):
 * Cmd/Ctrl+Z undoes; Shift+Cmd/Ctrl+Z and Ctrl+Y redo. Cmd and Ctrl are both
 * accepted on every platform. `undoKeyAction` is the rule, pure and tested;
 * `undoKeyFacts` reads the facts off a DOM event, reusing `transportKeys.ts`'s
 * text-entry and dialog rule, and `undoControls.ts` attaches the listener.
 */
import { keyFacts } from './transportKeys';

/** What a keydown carries that decides an undo or a redo. */
export interface UndoKeyFacts {
  /** `KeyboardEvent.key`: `'z'`, or `'Z'` with Shift held. */
  readonly key: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  /** Focus is in a text input, textarea, select or contenteditable element. */
  readonly editing: boolean;
  /** Focus is inside an open modal dialog. */
  readonly inDialog: boolean;
}

export type UndoKeyAction = 'undo' | 'redo' | null;

/**
 * `null` leaves the key alone: a text field keeps the browser's own text
 * undo, and a key with Alt, or with no Cmd or Ctrl, isn't ours. A held key
 * repeats the action, as in other DAWs.
 */
export function undoKeyAction(facts: UndoKeyFacts): UndoKeyAction {
  if (facts.editing || facts.inDialog || facts.alt) return null;
  const key = facts.key.toLowerCase();
  if (key === 'z' && (facts.ctrl || facts.meta)) return facts.shift ? 'redo' : 'undo';
  if (key === 'y' && facts.ctrl && !facts.meta && !facts.shift) return 'redo';
  return null;
}

/** The facts of a DOM keydown. */
export function undoKeyFacts(e: KeyboardEvent): UndoKeyFacts {
  const { editing, inDialog } = keyFacts(e);
  return {
    key: e.key,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
    editing,
    inDialog,
  };
}
