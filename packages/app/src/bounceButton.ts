/**
 * The Bounce to Roll button in the Song view's pane header (windsor#742,
 * record `2026-10-11-bounce-to-roll` decisions 1, 2, 6 and 8). A press runs
 * the engine's `bounceToRoll` on the document as it stands and commits its
 * one partial as one undo step, "Bounce to Roll", with no confirmation: the
 * pane then draws the part as a Roll, and an `info` toast sums up what the
 * bounce approximated. A refusal changes nothing and shows an `error` toast.
 * Its state is `bounceButtonModel.ts`, its words `bounceToastModel.ts`.
 */
import type { MusicPart } from '@windsor/engine';
import { bounceToRoll, partAt } from '@windsor/engine';
import { el } from './dom';
import { withGesture } from './gestureHooks';
import { bounceButtonState } from './bounceButtonModel';
import { BOUNCE_BUTTON } from './bounceTables';
import { bounceRefusalText, bounceSuccessText } from './bounceToastModel';
import type { SongView } from './songTab';

/** Bounce the part on `slot`, read from the document at the press. */
function bounce(view: SongView, slot: number): void {
  const { doc } = view.ctx.model;
  const part = partAt(doc, slot);
  // The pane may be older than the part: bounce only what still offers it.
  if (!part || bounceButtonState(part)?.disabled !== false) return;
  const result = bounceToRoll(doc, slot);
  if (!result.ok) {
    view.ctx.notify(bounceRefusalText(result.refusal), 'error');
    return;
  }
  // `stepLabel` would name the step from the partial's sections, so the gesture names it.
  if (withGesture(BOUNCE_BUTTON.undo, () => view.commit(result.partial, true))) {
    view.ctx.notify(bounceSuccessText(result.summary), 'info');
  }
}

/** The header's button for `part`, or null where it is not shown (a Roll, no sequencer). */
export function bounceButton(view: SongView, part: MusicPart): HTMLButtonElement | null {
  const state = bounceButtonState(part);
  if (!state) return null;
  const button = el('button', 'btn bounce', BOUNCE_BUTTON.label) as HTMLButtonElement;
  button.type = 'button';
  button.disabled = state.disabled;
  button.title = state.title;
  button.onclick = (): void => bounce(view, part.slot);
  return button;
}
