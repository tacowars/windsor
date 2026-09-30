/**
 * A selected part's insert chain in the Song view's detail pane, under its
 * sequencer card (windsor#156, `2026-09-30-mixer-on-the-song-tab` decision 7):
 * a header — the fold arrow, "Insert effects" and the count — and, while open,
 * the Mixer tab's own chain from `stripInserts.ts`: each insert's card with
 * ◀ ▶ and Remove, then "Add insert…".
 *
 * The chain edits through `songPaneCtx`, so a Song-tab edit marks the Mixer
 * tab stale. The other way round, a Mixer-tab knob marks nothing, so the panel
 * remembers the chain it drew and `stale` says when the document's differs
 * other than by the panel's own edit; the Song view's frame watch then
 * repaints the pane.
 */
import { el } from './dom';
import { insertsOf } from './insertTarget';
import { insertCountLabel, songPaneCtx } from './songInsertModel';
import { foldButton } from './songPaneFold';
import type { SongView } from './songTab';
import { stripInserts } from './stripInserts';

export interface InsertPanel {
  readonly element: HTMLElement;
  /** The part's chain changed since it was drawn, by an edit made elsewhere. */
  stale(): boolean;
}

export function insertPanel(view: SongView, slot: number): InsertPanel {
  const { ctx } = view;
  const chain = (): string => JSON.stringify(insertsOf(ctx, slot));
  let drawn = chain();
  const section = el('section', 'pane-inserts');
  const head = el('div', 'card-head');
  const label = el('span', '');
  label.appendChild(foldButton(view, 'insertsOpen', 'Insert effects'));
  label.appendChild(document.createTextNode('Insert effects'));
  label.appendChild(el('small', '', insertCountLabel(insertsOf(ctx, slot).length)));
  head.appendChild(label);
  section.appendChild(head);
  if (view.state.insertsOpen) {
    const paneCtx = songPaneCtx(ctx, () => {
      drawn = chain();
    });
    section.appendChild(stripInserts(paneCtx, slot));
  }
  return { element: section, stale: () => chain() !== drawn };
}
