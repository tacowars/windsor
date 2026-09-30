/**
 * A collapse arrow in the Song view's detail pane (windsor#156): ▾ while its
 * section is open, ▸ while folded. A real button with `aria-expanded`, so it
 * is reachable from the keyboard; a press flips the view-state flag it names,
 * repaints the pane, and keeps the focus on the arrow the repaint drew.
 */
import { el } from './dom';
import type { SongView, SongViewState } from './songTab';

/** The view-state flags an arrow folds: session-only, shared by every part. */
export type PaneFold = keyof Pick<SongViewState, 'sequencerOpen' | 'insertsOpen'>;

export function foldButton(view: SongView, fold: PaneFold, section: string): HTMLButtonElement {
  const open = view.state[fold];
  const button = el('button', 'btn nudge fold', open ? '▾' : '▸') as HTMLButtonElement;
  button.type = 'button';
  button.dataset.fold = fold;
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', section);
  button.title = `${open ? 'Collapse' : 'Expand'} ${section.toLowerCase()}`;
  button.onclick = (): void => {
    const pane = button.closest('.detail-pane');
    view.state[fold] = !open;
    view.paintPane();
    pane?.querySelector<HTMLButtonElement>(`[data-fold="${fold}"]`)?.focus();
  };
  return button;
}
