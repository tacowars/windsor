/**
 * The space bar toggles the transport (windsor#111), as in Ableton Live:
 * stopped or paused, Space plays; playing, Space pauses and keeps the
 * position. `spaceAction` is the rule, pure and tested; `keyFacts` reads the
 * few facts it needs off a DOM event, and `transportStrip.ts` attaches the
 * one listener.
 */
import type { TransportState } from './transportModel';

/** What a keydown carries that decides the toggle. */
export interface SpaceKeyFacts {
  /** `KeyboardEvent.key`: `' '` for the space bar. */
  readonly key: string;
  /** Auto-repeat from a held key. */
  readonly repeat: boolean;
  /** Ctrl, Meta or Alt is held: a shortcut of the system's or the browser's, not ours. */
  readonly modified: boolean;
  /** Focus is in a text input, textarea, select or contenteditable element. */
  readonly editing: boolean;
  /** Focus is inside an open modal dialog. */
  readonly inDialog: boolean;
}

/**
 * `play` and `pause` toggle and swallow the key; `hold` swallows a held
 * Space's repeats so the page neither scrolls nor re-toggles; `null` leaves
 * the key alone, so a text field still types its space.
 */
export type SpaceAction = 'play' | 'pause' | 'hold' | null;

export function spaceAction(facts: SpaceKeyFacts, state: TransportState): SpaceAction {
  if (facts.key !== ' ' || facts.modified || facts.editing || facts.inDialog) return null;
  if (facts.repeat) return 'hold';
  return state === 'playing' ? 'pause' : 'play';
}

const EDITABLE_TAGS: ReadonlySet<string> = new Set(['input', 'textarea', 'select']);

/** The facts of a DOM keydown; the text-entry rule matches `keyboard.ts`'s audition keys. */
export function keyFacts(e: KeyboardEvent): SpaceKeyFacts {
  const target = e.target instanceof HTMLElement ? e.target : null;
  return {
    key: e.key,
    repeat: e.repeat,
    modified: e.ctrlKey || e.metaKey || e.altKey,
    editing:
      target !== null &&
      (EDITABLE_TAGS.has(target.tagName.toLowerCase()) || target.isContentEditable),
    inDialog: target?.closest('dialog[open]') != null,
  };
}
