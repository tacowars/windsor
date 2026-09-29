/**
 * The Undo and Redo buttons in the header, and the keys that do the same
 * (windsor#131, epic windsor#112 decision 8). The buttons follow the
 * history through `onHistoryChange`: disabled with nothing to take back or
 * make again, and titled with the step ("Undo Cutoff"). A refused undo (a
 * gesture still open, the engine refusing) shows nothing beyond what
 * `AppContext` already notifies.
 */
import type { AppContext } from './appContext';
import { html } from './dom';
import { undoKeyAction, undoKeyFacts } from './undoKeys';

/** The history facts the buttons read; `AppContext` supplies them. */
export interface UndoHistoryView {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

/** One button's state. */
export interface UndoButtonState {
  readonly disabled: boolean;
  readonly title: string;
}

/** What each button shows for the history as it stands. */
export function undoButtonStates(view: UndoHistoryView): {
  undo: UndoButtonState;
  redo: UndoButtonState;
} {
  return {
    undo: {
      disabled: !view.canUndo,
      title: view.canUndo ? `Undo ${view.undoLabel ?? ''}`.trim() : 'Nothing to undo',
    },
    redo: {
      disabled: !view.canRedo,
      title: view.canRedo ? `Redo ${view.redoLabel ?? ''}`.trim() : 'Nothing to redo',
    },
  };
}

/**
 * A curved arrow, drawn as the Settings gear is: icons rather than words keep
 * the pair narrow, so the header holds one line nearly as far down as before.
 */
function arrowIcon(flip: boolean): string {
  const turn = flip ? ' transform="matrix(-1 0 0 1 24 0)"' : '';
  return (
    '<svg class="undo-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true" focusable="false"><g${turn}>` +
    '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></g></svg>'
  );
}

function button(name: string, flip: boolean): HTMLButtonElement {
  const b = html('button', 'btn undo-btn', arrowIcon(flip)) as HTMLButtonElement;
  b.type = 'button';
  b.setAttribute('aria-label', name);
  return b;
}

function show(b: HTMLButtonElement, state: UndoButtonState): void {
  b.disabled = state.disabled;
  b.title = state.title;
}

/** Build the buttons into `root`, and attach the one document-level key listener. */
export function mountUndoControls(ctx: AppContext<HTMLElement>, root: HTMLElement): void {
  const undo = button('Undo', false);
  const redo = button('Redo', true);
  undo.addEventListener('click', () => ctx.undo());
  redo.addEventListener('click', () => ctx.redo());
  root.append(undo, redo);
  const update = (): void => {
    const states = undoButtonStates(ctx);
    show(undo, states.undo);
    show(redo, states.redo);
  };
  ctx.onHistoryChange(update);
  update();
  document.addEventListener('keydown', (e) => {
    const action = undoKeyAction(undoKeyFacts(e));
    if (action === null) return;
    e.preventDefault();
    // The audition keyboard listens on `window`, after `document`: without
    // this, Cmd+Z would also drop its octave and Ctrl+Y play a note.
    e.stopPropagation();
    if (action === 'undo') ctx.undo();
    else ctx.redo();
  });
}
