/**
 * The Fold control (windsor#919, record `2026-10-18-keyboard-fold`
 * decision 2, Decided 3): **Fold: Off · Scale · Chord**, built as the
 * expanded view's Octaves and Rows (`.kb-pick`, `.kb-seg`, 28 px). One
 * builder for every place it sits: after Oct + on the Parts tab's keys row,
 * after Rows in the expanded keyboard's bar, and on the Roll device.
 *
 * Every Fold control on screen shows the fold of the part the keyboard
 * plays: the keyboard marks each `[data-keys-fold]` after it builds its keys
 * (`markFolds`), as it writes every octave label and Hold button.
 */
import { el } from './dom';
import { FOLD_LABELS } from './keyboardConstants';
import type { PartFold } from './keyboardFold';

/** The options, in the order they show. */
export const FOLDS: readonly PartFold[] = ['off', 'scale', 'chord'];

/** A Fold control whose tap hands `onPick` the fold; `label` names it (`Fold` by default). */
export function foldControl(
  onPick: (fold: PartFold) => void,
  label: string = FOLD_LABELS.fold,
): HTMLElement {
  const group = el('span', 'kb-pick');
  group.dataset.keysFold = '';
  const options = el('div', 'seg kb-seg');
  for (const fold of FOLDS) {
    const button = el('button', '', FOLD_LABELS[fold]) as HTMLButtonElement;
    button.type = 'button';
    button.dataset.fold = fold;
    button.setAttribute('aria-pressed', 'false');
    button.onclick = (): void => onPick(fold);
    options.append(button);
  }
  group.append(el('span', 'kb-pick-label', label), options);
  return group;
}

/** Press `fold` on every Fold control in `root`. */
export function markFolds(fold: PartFold, root: ParentNode = document): void {
  for (const button of root.querySelectorAll<HTMLElement>('[data-keys-fold] [data-fold]'))
    button.setAttribute('aria-pressed', String(button.dataset.fold === fold));
}
