/**
 * The audition keyboard's computer keys (#70, windsor#349, windsor#521,
 * windsor#921): which presses play, and the note a letter plays. Pure over
 * the event's fields, the octave and the fold's set, so `keyboard.ts` keeps
 * only the held-note bookkeeping.
 *
 * Folded (record `2026-10-18-keyboard-fold` decision 6), the home row plays
 * the folded keys in order, running on past the shown keys, and every other
 * note letter plays nothing; unfolded, each letter is its semitone from the
 * octave's C, as before the fold.
 */
import { SEMITONES_PER_OCTAVE } from '@windsor/engine';
import { AUDITION_TAB, QWERTY } from './keyboardConstants';
import { type FoldSet, homeRowNote } from './keyboardFold';

/** Whether the QWERTY keys play while `activeTab` is shown: only on the audition tab. */
export const qwertyPlaysOn = (activeTab: string | null, auditionTab = AUDITION_TAB): boolean =>
  activeTab === auditionTab;

/**
 * Whether a press is a shortcut rather than a note: anything held with Ctrl,
 * Meta or Alt. ⌘K opening the patch search used to strike the `k` key's C
 * as well (windsor#521), and Ctrl+Z shifted the octave; no chord plays.
 * Shift is left alone: it changes `e.key`, and a shifted letter maps to no key.
 */
export const isShortcutPress = (
  e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>,
): boolean => e.ctrlKey || e.metaKey || e.altKey;

/**
 * Whether a press goes to what has focus rather than the keys: typing in a
 * field, or a modal's buttons (#563), where focus is trapped until it closes.
 */
export function pressForFocus(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.closest('dialog[open]') !== null;
}

/**
 * The note `letter` plays at `octave`: over a folded part's `set`, the home
 * row's (`homeRowNote`: nothing past the range or for any other letter);
 * unfolded (`set` null), the octave's C plus the letter's offset. Null for
 * a letter that plays nothing.
 */
export function qwertyNote(letter: string, octave: number, set: FoldSet | null): number | null {
  if (set) return homeRowNote(letter, set, octave);
  const off = QWERTY[letter];
  return off === undefined ? null : octave * SEMITONES_PER_OCTAVE + off;
}
