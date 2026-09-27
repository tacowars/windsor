/**
 * The Song view (#709; epic #703 decision 1, layout B with the detail pane
 * at the bottom): a bar ruler, the harmony lane, one lane of regions per
 * part by slot, one playhead line through all of them, and a pane under the
 * lanes hosting the selected part's card from `SEQUENCER_CARDS` or the
 * selected chord's harmony card. It replaces the Sequencers and Harmony tabs.
 *
 * This file is the view's composition and its one piece of state — the
 * selection — plus the two repaints every edit ends in. The lanes are
 * `songRuler.ts`, `songHarmonyLane.ts` and `songLanes.ts`; the pane is
 * `songDetailPane.ts`; the edits themselves are the pure `regionModel.ts` and
 * `harmonyLaneModel.ts`. Every edit is one `ctx.change` live partial, never
 * a rebuild; the lanes repaint from the document, so a card's knob in the
 * pane (a grid's Length, a Reseed) shows on its lane the next frame through
 * the ruler watch's signature check, and the one playhead loop is
 * `stepStrip.ts`'s (decision 5).
 */
import type { DocumentPartial } from '@windsor/engine';
import { songTicksOf } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { paintDetailPane } from './songDetailPane';
import { harmonyLaneRow, markPlayingBlock } from './songHarmonyLane';
import { partLaneRow } from './songLanes';
import { playheadLine, rulerRow, watchSongPlayhead } from './songRuler';
import { CYCLE_TICKS, REGION_SUMMARY, SONG_VIEW, forKind } from './songViewTables';

/** What the pane shows: a part (and, when a block was clicked, which of its regions), a chord event, or nothing. */
export type SongSelection =
  | { readonly kind: 'part'; readonly slot: number; readonly region: number | null }
  | { readonly kind: 'event'; readonly index: number }
  | null;

export interface SongViewState {
  selection: SongSelection;
}

/** What the lanes, the pane and the cards they host are handed. */
export interface SongView {
  readonly ctx: AppCtx;
  readonly state: SongViewState;
  songTicks(): number;
  /**
   * Write a partial live and, when it took, mark the other tabs stale and
   * repaint the lanes — and the pane when `pane` is set. False when refused.
   */
  commit(partial: DocumentPartial, pane?: boolean): boolean;
  /** Change the selection and repaint both. */
  select(selection: SongSelection): void;
  paintLanes(): void;
  paintPane(): void;
}

/** The lanes' input: what a repaint must follow when it changes under a card's knob. */
function laneSignature(ctx: AppCtx): string {
  const { doc } = ctx.model;
  return JSON.stringify([
    doc.transport.bars,
    doc.harmony,
    doc.parts.map((part) => [
      part.slot,
      part.name,
      part.regions,
      part.sequencer.kind,
      forKind(REGION_SUMMARY, part.sequencer),
      forKind(CYCLE_TICKS, part.sequencer),
    ]),
  ]);
}

/** The selection still names something in the document; else nothing is selected. */
function validSelection(ctx: AppCtx, selection: SongSelection): SongSelection {
  if (!selection) return null;
  const { doc } = ctx.model;
  if (selection.kind === 'event') {
    return selection.index < doc.harmony.events.length ? selection : null;
  }
  const part = doc.parts.find((p) => p.slot === selection.slot);
  if (!part) return null;
  const region = selection.region !== null && selection.region < part.regions.length;
  return region ? selection : { kind: 'part', slot: selection.slot, region: null };
}

// eslint-disable-next-line max-lines-per-function -- the view's one composition: the lanes, the pane, the watch and the SongView the lanes call back into read as one sequence
function renderSongView(body: HTMLElement, ctx: AppCtx, state: SongViewState): void {
  body.innerHTML = '';
  state.selection = validSelection(ctx, state.selection);
  const scroll = el('div', 'lanes-scroll');
  const lanes = el('div', 'lanes');
  lanes.style.setProperty('--bar', `${SONG_VIEW.pxPerBar}px`);
  lanes.style.setProperty('--names', `${SONG_VIEW.laneNameWidthPx}px`);
  lanes.style.setProperty('--gap', `${SONG_VIEW.laneGapPx}px`);
  const line = playheadLine();
  const pane = el('div', 'detail-pane');
  scroll.appendChild(lanes);
  body.appendChild(scroll);
  body.appendChild(pane);

  const view: SongView = {
    ctx,
    state,
    songTicks: () => songTicksOf(ctx.model.doc),
    commit(partial, paintPane = false) {
      if (!ctx.change(partial).ok) return false;
      ctx.invalidate();
      state.selection = validSelection(ctx, state.selection);
      signature = laneSignature(ctx);
      view.paintLanes();
      if (paintPane) view.paintPane();
      return true;
    },
    select(selection) {
      state.selection = validSelection(ctx, selection);
      view.paintLanes();
      view.paintPane();
    },
    paintLanes() {
      const { doc } = ctx.model;
      lanes.style.setProperty('--bars', String(doc.transport.bars));
      const rows: HTMLElement[] = [
        ...rulerRow(doc.transport.bars),
        ...harmonyLaneRow(view),
        ...doc.parts.flatMap((part) => partLaneRow(view, part)),
      ];
      lanes.replaceChildren(...rows, line);
    },
    paintPane() {
      paintDetailPane(pane, view);
    },
  };
  let signature = laneSignature(ctx);
  view.paintLanes();
  view.paintPane();
  watchSongPlayhead({
    ctx,
    lanes,
    line,
    songTicks: view.songTicks,
    onTick: (tick) => markPlayingBlock(lanes, ctx.model.doc, view.songTicks(), tick),
    repaintIf: () => {
      const now = laneSignature(ctx);
      if (now === signature) return;
      signature = now;
      state.selection = validSelection(ctx, state.selection);
      view.paintLanes();
    },
  });
}

/** The tab's renderer, keeping its selection across renders — what `main.ts` registers as Song. */
export function songTab(ctx: AppCtx): (body: HTMLElement) => void {
  const state: SongViewState = { selection: null };
  return (body) => renderSongView(body, ctx, state);
}
