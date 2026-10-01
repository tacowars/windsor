/**
 * The Song view (#709; epic #703 decision 1, layout B with the detail pane
 * at the bottom): a bar ruler, the harmony lane, one lane of regions per
 * part by slot, one playhead line through all of them, and a pane under the
 * lanes hosting the selected part's card from `SEQUENCER_CARDS` or the
 * selected chord's harmony card. It replaces the Sequencers and Harmony tabs.
 *
 * This file is the view's composition and its one piece of state — the
 * selection — plus the two repaints every edit ends in. The lanes are
 * `songRuler.ts`, the loop brace under it (`loopBrace.ts`, windsor#30),
 * `songHarmonyLane.ts` and `songLanes.ts`, with the mixer column's cell
 * between each row's name and lane (`songMixerCell.ts`, windsor#157); the pane is
 * `songDetailPane.ts`; the edits themselves are the pure `regionModel.ts` and
 * `harmonyLaneModel.ts`. Every edit is one `ctx.change` live partial, never
 * a rebuild; the lanes repaint from the document, so a card's knob in the
 * pane (a grid's Length, a Reseed) shows on its lane the next frame through
 * the ruler watch's signature check, and the one playhead loop is
 * `stepStrip.ts`'s (decision 5).
 *
 * A part's `▸` folds its automation lanes out beneath it (windsor#348,
 * `songAutomationLane.ts`). Which parts are open is view state; the lanes'
 * values follow the playhead from that same loop, without a repaint.
 */
import type { DocumentPartial } from '@windsor/engine';
import { regionPattern, songTicksOf } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { loopBraceRow } from './loopBrace';
import type { DetailPane } from './songDetailPane';
import { paintDetailPane } from './songDetailPane';
import { harmonyLaneRow, markPlayingBlock } from './songHarmonyLane';
import { partLaneRow } from './songLanes';
import {
  EXPANDED_KNOB_COUNT,
  emptyMixerCell,
  mixerHeaderCell,
  partMixerCell,
  refreshMixerCells,
} from './songMixerCell';
import { automationRows, type Readout } from './songAutomationLane';
import { automationSignature } from './songAutomationModel';
import { songMixerLights } from './songMixerLights';
import type { MixerLights } from './songMixerLights';
import { stripSignature } from './songMixerModel';
import { guardFrozenColumns } from './songFrozenColumns';
import {
  playheadLine,
  rulerRow,
  watchSongPlayhead,
  wirePlayheadDrag,
  wireRulerZoom,
} from './songRuler';
import { CYCLE_TICKS, REGION_SUMMARY, SONG_VIEW, forKind, mixerColumnPx } from './songViewTables';

/** A row's name cell and lane with the mixer column's cell between them (windsor#157). */
const withMixer = ([name, lane]: [HTMLElement, HTMLElement], cell: HTMLElement): HTMLElement[] => [
  name,
  cell,
  lane,
];

/** What the pane shows: a part (and, when a block was clicked, which of its regions), a chord event, or nothing. */
export type SongSelection =
  | { readonly kind: 'part'; readonly slot: number; readonly region: number | null }
  | { readonly kind: 'event'; readonly index: number }
  | null;

export interface SongViewState {
  selection: SongSelection;
  /**
   * The zoom (windsor#8): px one bar spans, set by the ruler drag within
   * `SONG_VIEW`'s bounds. View state, like the scroll below: kept across
   * renders of the tab, never written to the document or the autosave.
   */
  pxPerBar: number;
  /** The lanes' horizontal scroll, restored after a render. */
  scrollPx: number;
  /**
   * The zoom's floor as last measured: the fit, the scale at which the whole
   * song fills the window (windsor#21), or `SONG_VIEW.minPxPerBar` under it.
   * Null until the view first has a width. A zoom sitting on it follows it.
   */
  floorPxPerBar: number | null;
  /**
   * The detail pane's arrows (windsor#156): the sequencer section and the
   * insert panel open or folded. Shared by every part, kept across renders,
   * never written to the document; both start open.
   */
  sequencerOpen: boolean;
  insertsOpen: boolean;
  /** The detail pane's vertical scroll, restored after a repaint or a render (an insert added or removed). */
  paneScrollPx: number;
  /**
   * The mixer column's arrow (windsor#158): every strip expanded to all its
   * controls, or collapsed to Level, M and S. Kept across renders, never
   * written to the document; starts collapsed.
   */
  mixerExpanded: boolean;
  /**
   * The parts whose automation lanes are folded out (windsor#348 decision
   * 1), by slot. Kept for the session, never written to the document; every
   * part starts folded.
   */
  readonly openParts: Set<number>;
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

/**
 * The lanes' input: what a repaint must follow when it changes under a card's
 * knob. A part's strip is left out (windsor#157): the mixer column's knob
 * edits it mid-drag, and a repaint would rebuild the knob under the pointer.
 */
function laneSignature(ctx: AppCtx, open: ReadonlySet<number>): string {
  const { doc } = ctx.model;
  return JSON.stringify([
    doc.transport.bars,
    doc.transport.loop ?? null,
    doc.harmony,
    doc.parts.map((part) => [
      part.slot,
      part.name,
      part.regions,
      part.sequencer.kind,
      // Its lanes (windsor#348 decision 7), and what its inserts' settings let them move.
      automationSignature(part, open.has(part.slot)),
      // Each region's own pattern (windsor#75): a region without one shows the part's sequencer.
      part.regions.map((_, i) => {
        const pattern = regionPattern(part, i);
        return [forKind(REGION_SUMMARY, pattern), forKind(CYCLE_TICKS, pattern)];
      }),
    ]),
  ]);
}

/**
 * The selection still names something in the document; else nothing is
 * selected. A part selected without a region, or with one that is gone,
 * selects its first region (windsor#75 decision 2), so the pane says which
 * region its card edits.
 */
function validSelection(ctx: AppCtx, selection: SongSelection): SongSelection {
  if (!selection) return null;
  const { doc } = ctx.model;
  if (selection.kind === 'event') {
    return selection.index < doc.harmony.events.length ? selection : null;
  }
  const part = doc.parts.find((p) => p.slot === selection.slot);
  if (!part) return null;
  const region = selection.region !== null && selection.region < part.regions.length;
  if (region) return selection;
  return { kind: 'part', slot: selection.slot, region: part.regions.length > 0 ? 0 : null };
}

// eslint-disable-next-line max-lines-per-function -- the view's one composition: the lanes, the pane, the watch and the SongView the lanes call back into read as one sequence
function renderSongView(
  body: HTMLElement,
  ctx: AppCtx,
  state: SongViewState,
  lights: MixerLights,
): void {
  body.innerHTML = '';
  state.selection = validSelection(ctx, state.selection);
  const scroll = el('div', 'lanes-scroll');
  const lanes = el('div', 'lanes');
  lanes.style.setProperty('--names', `${SONG_VIEW.laneNameWidthPx}px`);
  const sizeMixer = (): void =>
    lanes.style.setProperty(
      '--mixer',
      `${mixerColumnPx(state.mixerExpanded, EXPANDED_KNOB_COUNT)}px`,
    );
  sizeMixer();
  lanes.style.setProperty('--mix-knobs', String(EXPANDED_KNOB_COUNT));
  lanes.style.setProperty('--gap', `${SONG_VIEW.laneGapPx}px`);
  lanes.style.setProperty('--auto-lane-h', `${SONG_VIEW.automationLanePx}px`);
  lanes.style.setProperty('--auto-add-h', `${SONG_VIEW.automationAddRowPx}px`);
  guardFrozenColumns(lanes, SONG_VIEW.laneGapPx);
  const line = playheadLine();
  const pane = el('div', 'detail-pane');
  scroll.appendChild(lanes);
  body.appendChild(scroll);
  body.appendChild(pane);
  scroll.addEventListener('scroll', () => {
    state.scrollPx = scroll.scrollLeft;
  });
  pane.addEventListener('scroll', () => {
    state.paneScrollPx = pane.scrollTop;
  });
  let signature = '';
  // The lanes' value cells (windsor#348): set from the playhead's tick, in the song.
  let readouts: Readout[] = [];
  const readValues = (tick: number): void => {
    const songTicks = view.songTicks();
    const songTick = songTicks > 0 ? ((tick % songTicks) + songTicks) % songTicks : 0;
    for (const read of readouts) read(songTick);
  };
  let paneDrawn: DetailPane = { stale: () => false, refreshHead: () => undefined };
  // Set once the zoom is wired below; the arrow can only be pressed after that.
  let refit = (): void => undefined;
  const mixer = {
    get expanded(): boolean {
      return state.mixerExpanded;
    },
    toggle(): void {
      state.mixerExpanded = !state.mixerExpanded;
      sizeMixer();
      view.paintLanes();
      // The fit reads the grid's width, so it is measured on the new cells.
      refit();
      lanes.querySelector<HTMLElement>('.mix-toggle')?.focus();
    },
  };

  const view: SongView = {
    ctx,
    state,
    songTicks: () => songTicksOf(ctx.model.doc),
    commit(partial, paintPane = false) {
      if (!ctx.change(partial).ok) return false;
      ctx.invalidate();
      state.selection = validSelection(ctx, state.selection);
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
      // What is drawn, so the watch repaints only on a change from elsewhere (a fold changes it too).
      signature = laneSignature(ctx, state.openParts);
      lanes.style.setProperty('--bars', String(doc.transport.bars));
      lanes.style.setProperty('--bar', `${state.pxPerBar}px`);
      const brace = loopBraceRow(view);
      const fresh: Readout[] = [];
      const rows: HTMLElement[] = [
        ...withMixer(rulerRow(doc.transport.bars, state.pxPerBar), mixerHeaderCell(mixer)),
        ...withMixer(brace.row, emptyMixerCell()),
        ...withMixer(harmonyLaneRow(view), emptyMixerCell()),
        ...doc.parts.flatMap((part) => [
          ...withMixer(
            partLaneRow(view, part),
            partMixerCell(ctx, part, state.mixerExpanded, lights),
          ),
          ...(state.openParts.has(part.slot) ? automationRows(view, part, fresh) : []),
        ]),
      ];
      readouts = fresh;
      lanes.replaceChildren(...rows, ...brace.lines, line);
      readValues(ctx.transport.position());
      // The new blocks start unlit, and the loop marks only a moved tick: light the playing chord now, paused or not.
      markPlayingBlock(lanes, doc, view.songTicks(), ctx.transport.position());
    },
    paintPane() {
      paneDrawn = paintDetailPane(pane, view);
    },
  };
  let stripsDrawn = stripSignature(ctx);
  view.paintLanes();
  view.paintPane();
  scroll.scrollLeft = state.scrollPx;
  const zoom = wireRulerZoom({
    scroll,
    lanes,
    state,
    bars: () => ctx.model.doc.transport.bars,
    repaint: () => view.paintLanes(),
  });
  refit = zoom.refit;
  const onTick = (tick: number): void => {
    markPlayingBlock(lanes, ctx.model.doc, view.songTicks(), tick);
    readValues(tick);
  };
  const drag = wirePlayheadDrag({
    ctx,
    lanes,
    line,
    pxPerBar: () => state.pxPerBar,
    bars: () => ctx.model.doc.transport.bars,
    songTicks: view.songTicks,
    onTick,
  });
  watchSongPlayhead({
    ctx,
    lanes,
    line,
    songTicks: view.songTicks,
    onTick,
    drag,
    repaintIf: () => {
      // The insert panel's chain edited on the Mixer tab, which marks this tab nothing.
      if (paneDrawn.stale()) view.paintPane();
      // A strip edited on the Mixer tab: the column redraws in place, never rebuilt under a knob.
      const strips = stripSignature(ctx);
      if (strips !== stripsDrawn) {
        stripsDrawn = strips;
        refreshMixerCells(lanes);
      }
      const now = laneSignature(ctx, state.openParts);
      if (now === signature) return;
      signature = now;
      state.selection = validSelection(ctx, state.selection);
      view.paintLanes();
      // A card's edit never redraws the pane (the knob stays under the pointer): its header follows in place.
      paneDrawn.refreshHead();
      zoom.refit();
    },
  });
}

/** The tab's renderer, keeping its selection across renders — what `main.ts` registers as Song. */
export function songTab(ctx: AppCtx): (body: HTMLElement) => void {
  const state: SongViewState = {
    selection: null,
    pxPerBar: SONG_VIEW.pxPerBar,
    scrollPx: 0,
    floorPxPerBar: null,
    sequencerOpen: true,
    insertsOpen: true,
    paneScrollPx: 0,
    mixerExpanded: false,
    openParts: new Set(),
  };
  // The mixer column's lights (windsor#159): one poller for the view, outliving each render's cells.
  const lights = songMixerLights(ctx);
  return (body) => renderSongView(body, ctx, state, lights);
}
