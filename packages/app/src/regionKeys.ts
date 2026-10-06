/**
 * The Song view's region keys (record
 * `2026-10-06-song-region-move-copy-paste`): Cmd/Ctrl+C copies the selected
 * region, Cmd/Ctrl+X cuts it, Cmd/Ctrl+V pastes at the playhead's bar on
 * the selected part's lane, Cmd/Ctrl+D duplicates the region right after
 * itself, and Delete or Backspace removes it. Cmd and Ctrl are both accepted
 * on every platform, as the undo keys are. `regionKeyAction` is the rule,
 * pure and tested; `regionKeyFacts` reads the facts off a DOM event with
 * `transportKeys.ts`'s text-entry and dialog rule, and
 * `songRegionKeys.ts` attaches the listener.
 */
import { keyFacts } from './transportKeys';

/** What a keydown carries that decides a region key. */
export interface RegionKeyFacts {
  /** `KeyboardEvent.key`. */
  readonly key: string;
  /** Cmd or Ctrl is held. */
  readonly command: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  /** Focus is in a text input, textarea, select or contenteditable element. */
  readonly editing: boolean;
  /** Focus is inside an open modal dialog. */
  readonly inDialog: boolean;
}

export type RegionKeyAction = 'copy' | 'cut' | 'paste' | 'duplicate' | 'delete' | null;

const COMMAND_KEYS: Readonly<Record<string, RegionKeyAction>> = {
  c: 'copy',
  x: 'cut',
  v: 'paste',
  d: 'duplicate',
};

const DELETE_KEYS: ReadonlySet<string> = new Set(['Delete', 'Backspace']);

/**
 * `null` leaves the key alone: a text field keeps its own clipboard and
 * its own Backspace, a dialog its keys, and a chord with Shift or Alt is
 * someone else's.
 */
export function regionKeyAction(facts: RegionKeyFacts): RegionKeyAction {
  if (facts.editing || facts.inDialog || facts.alt || facts.shift) return null;
  if (facts.command) return COMMAND_KEYS[facts.key.toLowerCase()] ?? null;
  return DELETE_KEYS.has(facts.key) ? 'delete' : null;
}

/** The facts of a DOM keydown. */
export function regionKeyFacts(e: KeyboardEvent): RegionKeyFacts {
  const { editing, inDialog } = keyFacts(e);
  return {
    key: e.key,
    command: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
    editing,
    inDialog,
  };
}
