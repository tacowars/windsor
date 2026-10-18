/**
 * Keyboard fold on the Roll device (windsor#922; record
 * `2026-10-18-keyboard-fold` decision 2, Decided 3 and 5): windsor#919's
 * Fold control, labelled Keyboard fold beside the Roll's own Fold, drawn as
 * a Roll item (a field label over a 20 px switch), last in the second
 * column under Rec. It shows and edits the fold of the part the keyboard
 * plays, the slot Rec records into (`RecorderHost.selected`), through
 * windsor#918's write as one undo step. A device shown for any other part
 * draws it disabled, its title saying why. Rec's view reads it on the
 * device's frame (`rollRecView.ts`), since both follow that one slot.
 */
import type { ArrangementDocument } from '@windsor/engine';
import { partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import type { PartFold } from './keyboardFold';
import { foldControl, markFolds } from './keyboardFoldControl';
import { setPartFoldLive } from './keyboardFoldEdits';

/** The control's words. */
export const ROLL_KEYBOARD_FOLD = {
  label: 'Keyboard fold',
  follows: 'Fold follows the part the keyboard plays',
};

/** What the control shows: the played part's fold, and whether this device's part is it. */
export interface KeyboardFoldLook {
  readonly fold: PartFold;
  readonly live: boolean;
}

/** The look of the control on the device of `slot`, the keyboard playing `played`. */
export function keyboardFoldLook(
  doc: ArrangementDocument,
  played: number,
  slot: number,
): KeyboardFoldLook {
  return { fold: partAt(doc, played)?.fold ?? 'off', live: played === slot };
}

/** The control, and what the device calls on each frame. */
export interface RollKeyboardFold {
  readonly node: HTMLElement;
  /** Read the played part's fold and slot again; the control changes only when they moved. */
  frame(): void;
}

/** Keyboard fold on the device of `slot`; `played` names the slot the keyboard plays. */
export function rollKeyboardFold(
  ctx: AppCtx,
  slot: number,
  played: () => number,
): RollKeyboardFold {
  const node = foldControl((fold) => {
    if (played() === slot) setPartFoldLive(ctx, slot, fold);
    frame();
  }, ROLL_KEYBOARD_FOLD.label);
  // Drawn as a Roll item, not the keyboard bar's 28 px pick (the record's mockup).
  node.className = 'roll-item roll-kfold';
  node.querySelector('.kb-pick-label')?.setAttribute('class', 'field-label');
  node.querySelector('.kb-seg')?.setAttribute('class', 'seg roll-seg');
  const buttons = [...node.querySelectorAll('button')];
  let shown: KeyboardFoldLook | null = null;
  const frame = (): void => {
    const look = keyboardFoldLook(ctx.model.doc, played(), slot);
    if (shown && shown.fold === look.fold && shown.live === look.live) return;
    shown = look;
    markFolds(look.fold, node);
    node.classList.toggle('disabled', !look.live);
    node.title = look.live ? '' : ROLL_KEYBOARD_FOLD.follows;
    for (const button of buttons) button.disabled = !look.live;
  };
  frame();
  return { node, frame };
}
