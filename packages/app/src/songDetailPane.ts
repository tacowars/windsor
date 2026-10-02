/**
 * The Song view's detail pane (#709 decision 2): a fixed pane under the
 * lanes with a rule, a header — "Lead — Grid", "Harmony — bar 3" — and a
 * close ×. A selected part shows its card from `SEQUENCER_CARDS` as a
 * sequencer device (`sequencerDevice.ts`, windsor#368): the shared rail holds
 * the region as `n/m` with Split and Delete for the selected region, and the
 * pane has no region row, and every device that has an Octave draws its own
 * (the Chord's beside Vel and Gate). A selected chord shows `harmonyCard.ts`.
 * One selection at a time.
 *
 * The card edits the selected region's pattern
 * (windsor#75): a part selected without a region edits its first, and a
 * part with no regions shows a hint in place of the card.
 *
 * Under the card, a part's insert chain (`songInsertPanel.ts`, windsor#156).
 * The sequencer section and the insert panel each fold with an arrow
 * (`songPaneFold.ts`): folded, the sequencer keeps its header and hides the
 * device; the insert panel keeps only its header.
 */
import type { MusicPart, PartRegion } from '@windsor/engine';
import { partAt } from '@windsor/engine';
import { el } from './dom';
import { harmonyCard } from './harmonyCard';
import { insertPanel } from './songInsertPanel';
import { foldButton } from './songPaneFold';
import { SEQUENCER_CARDS } from './sequencerCards';
import { sequencerDevice } from './sequencerDevice';
import {
  canSplitRegion,
  regionBadge,
  removeRegionAt,
  splitRegionAtMiddle,
} from './sequencerDeviceModel';
import type { RailRegion } from './sequencerRail';
import type { SongView } from './songTab';
import type { PaneHeadText } from './songPaneHead';
import { editTarget, paneHeadText, partHeadText } from './songPaneHead';

/** What `paintDetailPane` drew: its staleness check and its header's in-place refresh. */
export interface DetailPane {
  /** Whether what it drew has gone stale under an edit made elsewhere (the insert panel's). */
  readonly stale: () => boolean;
  /** Rewrite the header's title and note from the document, where their text moved (windsor#123). */
  readonly refreshHead: () => void;
}

/** Writes the drawn header's title and note, each only when its text changed. */
type HeadWriter = (text: PaneHeadText) => void;

/** The pane's header: a part's fold arrow, the title, a small note, and the close ×. */
function head(
  view: SongView,
  text: PaneHeadText,
  fold?: HTMLElement,
): { row: HTMLElement; write: HeadWriter } {
  const row = el('div', 'card-head');
  const label = el('span', '');
  if (fold) label.appendChild(fold);
  const title = document.createTextNode(text.title);
  const note = el('small', '', text.note);
  label.appendChild(title);
  label.appendChild(note);
  row.appendChild(label);
  const close = el('button', 'btn nudge', '×') as HTMLButtonElement;
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.onclick = (): void => view.select(null);
  row.appendChild(close);
  const write: HeadWriter = (next) => {
    if (title.data !== next.title) title.data = next.title;
    if (note.textContent !== next.note) note.textContent = next.note;
  };
  return { row, write };
}

/**
 * The rail's region section (windsor#368): the region as `n/m`, and Split
 * and Delete acting on the selected region exactly as the pane's buttons did.
 * Each reads the part from the document at the press: a card's edit never
 * redraws the pane, so `part` is the part as the pane drew it, without the
 * steps programmed since.
 */
function railRegion(view: SongView, part: MusicPart, region: number | null): RailRegion {
  const { slot } = part;
  const badge = regionBadge(region, part.regions.length);
  const target = region === null ? undefined : part.regions[region];
  if (region === null || !target) return { badge, split: null, remove: null };
  const write = (regions: readonly PartRegion[] | null, select: number | null): void => {
    if (regions && view.commit({ parts: { [slot]: { regions: [...regions] } } })) {
      view.select({ kind: 'part', slot, region: select });
    }
  };
  const split = (): void =>
    write(splitRegionAtMiddle(view.ctx.model.doc, slot, region), region + 1);
  return {
    badge,
    split: canSplitRegion(target, view.ticksPerBar()) ? split : null,
    remove: () => write(removeRegionAt(view.ctx.model.doc, slot, region), null),
  };
}

/** What a selection's painter hands back: the staleness check and the header writer. */
interface Painted {
  readonly stale: () => boolean;
  readonly write: HeadWriter | null;
}

const NOTHING: Painted = { stale: () => false, write: null };

/** A part's sequencer section and insert panel. */
function paintPart(
  pane: HTMLElement,
  view: SongView,
  slot: number,
  region: number | null,
): Painted {
  const part = partAt(view.ctx.model.doc, slot);
  if (!part) return NOTHING;
  const { kind } = part.sequencer;
  const edited = editTarget(part, region);
  const header = head(
    view,
    partHeadText(part, region),
    foldButton(view, 'sequencerOpen', 'Sequencer'),
  );
  pane.appendChild(header.row);
  if (view.state.sequencerOpen) {
    pane.appendChild(
      edited === null
        ? el(
            'p',
            'hint',
            'No regions: click an empty stretch of the lane to draw one, then edit it here.',
          )
        : sequencerDevice({
            kind,
            slot,
            card: SEQUENCER_CARDS[kind](view.ctx, slot, edited),
            region: railRegion(view, part, region),
          }),
    );
  }
  const inserts = insertPanel(view, slot);
  pane.appendChild(inserts.element);
  return { stale: inserts.stale, write: header.write };
}

function paintEvent(pane: HTMLElement, view: SongView, index: number): Painted {
  const text = paneHeadText(view.ctx.model.doc, { kind: 'event', index });
  if (!text) return NOTHING;
  const header = head(view, text);
  pane.appendChild(header.row);
  pane.appendChild(harmonyCard(view, index));
  return { stale: () => false, write: header.write };
}

function paintSelection(pane: HTMLElement, view: SongView): Painted {
  const { selection } = view.state;
  if (selection?.kind === 'part') return paintPart(pane, view, selection.slot, selection.region);
  if (selection) return paintEvent(pane, view, selection.index);
  pane.appendChild(
    el(
      'p',
      'hint',
      'Select a region to edit its part, or a chord to edit the harmony. ' +
        'Click an empty stretch of a lane to add a region; + after the last chord appends one.',
    ),
  );
  return NOTHING;
}

/**
 * Redraw the pane for the view's selection at its kept scroll, which a
 * repaint or a whole render would otherwise reset. Returns its staleness
 * check and the header's in-place refresh, which a card's edit needs: the
 * edit never redraws the pane, so the knob under the pointer survives.
 */
export function paintDetailPane(pane: HTMLElement, view: SongView): DetailPane {
  pane.innerHTML = '';
  pane.classList.toggle('empty', view.state.selection === null);
  const { stale, write } = paintSelection(pane, view);
  pane.scrollTop = view.state.paneScrollPx;
  return {
    stale,
    refreshHead: () => {
      const text = paneHeadText(view.ctx.model.doc, view.state.selection);
      if (write && text) write(text);
    },
  };
}
