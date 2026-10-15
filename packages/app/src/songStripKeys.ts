/**
 * The Song tab's M and S (windsor#810; record
 * `2026-10-15-song-tab-mute-solo-keys`): M toggles the outlined part's mute
 * and S its solo, wherever the Song tab shows (the lanes, the detail pane,
 * the Roll, expanded or on its Envelopes tab). The outlined part is the
 * shared part selection the lanes draw (`outlinedSlot`), so the keys follow
 * it whether the detail pane is open, closed or showing a chord. Each press
 * goes through
 * `toggleStripSwitch`, the mixer column's own write, so it is one undo step
 * named "Mute <part>" or "Solo <part>".
 *
 * `stripKeyAction`, `stripKeySlot` and `pressStripKey` are the rule, pure
 * and tested;
 * `stripKeyFacts` reads the facts off a DOM event, and `wireStripKeys`
 * attaches the listener once per tab, beside the region keys.
 */
import { partAt } from '@windsor/engine';
import { isFieldFocused } from './songAutomationToolbar';
import { refreshMixerCells } from './songMixerCell';
import type { StripSwitch } from './songMixerModel';
import { switchEnabled, switchRefusal, toggleStripSwitch } from './songMixerModel';
import type { SongView } from './songTab';
import { outlinedSlot } from './songViewTables';

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

/**
 * The slot the keys act on: the outlined part, which is the shared part
 * selection (`ctx.parts.selected`) when the document has that part. The
 * detail pane's selection plays no part, so a closed pane or a selected
 * chord still leaves the outlined part as the target. Null with no such
 * part, and the key then goes on to the page.
 */
export const stripKeySlot = (
  shared: number,
  parts: readonly { readonly slot: number }[],
): number | null =>
  outlinedSlot(
    shared,
    parts.map((p) => p.slot),
  );

/** The outlined part's switches, as the key flips them. */
export interface StripKeyTarget {
  toggle(which: StripSwitch): void;
}

/**
 * Act on a keydown for `target` (null when no part is outlined); true when
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
 * The outlined part's switches: a sidechain-only part refuses an off switch
 * with a toast, as its disabled button's title says; any other press flips
 * the switch and redraws the mixer column.
 */
function targetOf(view: SongView, body: HTMLElement): StripKeyTarget | null {
  const { ctx } = view;
  const slot = stripKeySlot(ctx.parts.selected, ctx.model.doc.parts);
  if (slot === null) return null;
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
