/**
 * The Song tab's M and S (windsor#810; record
 * `2026-10-15-song-tab-mute-solo-keys`): M toggles the selected part's mute
 * and S its solo, wherever the Song tab shows (the lanes, the detail pane,
 * the Roll, expanded or on its Envelopes tab). Each press goes through
 * `toggleStripSwitch`, the mixer column's own write, so it is one undo step
 * named "Mute <part>" or "Solo <part>".
 *
 * `stripKeyAction` and `pressStripKey` are the rule, pure and tested;
 * `stripKeyFacts` reads the facts off a DOM event, and `wireStripKeys`
 * attaches the listener once per tab, beside the region keys.
 */
import { partAt } from '@windsor/engine';
import { isFieldFocused } from './songAutomationToolbar';
import { refreshMixerCells } from './songMixerCell';
import type { StripSwitch } from './songMixerModel';
import { switchEnabled, switchRefusal, toggleStripSwitch } from './songMixerModel';
import type { SongView } from './songTab';

/** What a keydown carries that decides a strip key. */
export interface StripKeyFacts {
  /** `KeyboardEvent.key`. */
  readonly key: string;
  /** Cmd or Ctrl is held. */
  readonly command: boolean;
  readonly alt: boolean;
  /** The key is held and this is a repeat. */
  readonly repeat: boolean;
  /** Focus is in a field (input, select, textarea, contenteditable) or an open dialog. */
  readonly field: boolean;
}

export type StripKeyAction = StripSwitch | null;

const KEYS: Readonly<Record<string, StripSwitch>> = { m: 'mute', s: 'solo' };

/**
 * The switch a plain M or S names, either case; `null` leaves the key alone:
 * a field or a dialog keeps its keys, and a Cmd, Ctrl or Alt chord is
 * someone else's. Shift is allowed, as Caps Lock is.
 */
export function stripKeyAction(facts: StripKeyFacts): StripKeyAction {
  if (facts.field || facts.command || facts.alt) return null;
  return KEYS[facts.key.toLowerCase()] ?? null;
}

/** The selected part's switches, as the key flips them. */
export interface StripKeyTarget {
  toggle(which: StripSwitch): void;
}

/**
 * Act on a keydown for `target` (null when no part is selected); true when
 * the key is ours and is swallowed. A held key acts on its first press, and
 * its repeats are swallowed without acting.
 */
export function pressStripKey(facts: StripKeyFacts, target: StripKeyTarget | null): boolean {
  const action = stripKeyAction(facts);
  if (action === null || target === null) return false;
  if (!facts.repeat) target.toggle(action);
  return true;
}

/** The facts of a DOM keydown. */
export function stripKeyFacts(e: KeyboardEvent): StripKeyFacts {
  return {
    key: e.key,
    command: e.ctrlKey || e.metaKey,
    alt: e.altKey,
    repeat: e.repeat,
    field: isFieldFocused(e),
  };
}

/**
 * The view's selected part, when the selection is one: a sidechain-only
 * part refuses an off switch with a toast, as its disabled button's title
 * says; any other press flips the switch and redraws the mixer column.
 */
function targetOf(view: SongView, body: HTMLElement): StripKeyTarget | null {
  const { ctx } = view;
  const selection = view.state.selection;
  if (selection?.kind !== 'part') return null;
  const { slot } = selection;
  if (!partAt(ctx.model.doc, slot)) return null;
  return {
    toggle(which) {
      const part = partAt(ctx.model.doc, slot);
      if (!part) return;
      if (!switchEnabled(part.strip, which)) {
        ctx.notify(switchRefusal(which, part.name), 'info');
        return;
      }
      if (toggleStripSwitch(ctx, slot, which)) refreshMixerCells(body);
    },
  };
}

/**
 * Listen on the document while `body`, the Song tab's, is shown: the keys
 * act on `current()`, the view of the latest render. Wired once per tab,
 * since the tab's body outlives its renders. A key that acts is swallowed,
 * so the window's listeners never hear it.
 */
export function wireStripKeys(body: HTMLElement, current: () => SongView | null): void {
  document.addEventListener('keydown', (e) => {
    const view = current();
    if (!view || !body.isConnected || body.closest('[hidden]') !== null) return;
    if (!pressStripKey(stripKeyFacts(e), targetOf(view, body))) return;
    e.preventDefault();
    e.stopPropagation();
  });
}
