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
 * `songHarmonyLane.ts` and `songLanes.ts`, each beside its block of the one
 * frozen column (`songLaneColumn.ts`, windsor#534), which holds the parts'
 * mixer strips (`songMixerCell.ts`, windsor#157); the pane is
 * `songDetailPane.ts`; the edits themselves are the pure `regionModel.ts` and
 * `harmonyLaneModel.ts`. Every edit is one `ctx.change` live partial, never
 * a rebuild; the lanes repaint from the document, so a card's knob in the
 * pane (a grid's Length, a Reseed) shows on its lane the next frame through
 * the ruler watch's signature check, and the one playhead loop is
 * `stepStrip.ts`'s (decision 5).
 *
 * A part's `▸` folds its automation lanes out beneath it (windsor#348,
 * `songAutomationLane.ts`). Which parts are open is view state; the lanes'
 * values follow the playhead from that same loop, without a repaint. While
 * any part is open, the lane toolbar sits above the lanes
 * (`songAutomationToolbar.ts`, windsor#349): its tool and snap are view
 * state too, as are the Shape tool's last settings (`songShapeRange.ts`,
 * windsor#350), whose popover lives for one render.
 *
 * Each group bus is a folder track (windsor#615): a header row with the
 * group's members indented under it, in the display order `songFolderModel.ts`
 * builds (the document and the slots never change), and a read-only lane
 * outlining where the group plays (`songGroupRow.ts`). A group's fold is view
 * state too, `closedGroups`; a member routed elsewhere moves on the next
 * repaint, since the lanes' signature holds each part's Output and the groups.
 *
 * The selected part is the Parts tab's too (windsor#462): selecting a part or
 * one of its regions picks it there (`ctx.parts.pick`), and a render follows
 * the shared selection, picked or reset elsewhere (`partSelectionSync.ts`).
 */
import type { DocumentPartial } from '@windsor/engine';
import { regionPattern, songTicksOf, ticksPerBar } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { loopBraceRow } from './loopBrace';
import type { DetailPane } from './songDetailPane';
import { paintDetailPane } from './songDetailPane';
import { harmonyLaneRow, markPlayingBlock } from './songHarmonyLane';
import { bodyGroups, harmonyGroup, headGroup, sizeLaneColumn } from './songLaneColumn';
import { pickedSlot, syncSongSelection } from './partSelectionSync';
import { refreshMixerCells } from './songMixerCell';
import { forgetRemovedGroups, songRows, visibleRows } from './songFolderModel';
import type { Readout } from './songAutomationLane';
import { automationSignature } from './songAutomationModel';
import {
  DEFAULT_AUTOMATION_TOOL,
  DEFAULT_SNAP_TICKS,
  type AutomationTool,
} from './songAutomationTables';
import { automationToolbar, syncAutomationTool, wireToolKeys } from './songAutomationToolbar';
import { shapeTool, type ShapeTool } from './songShapeRange';
import { DEFAULT_SHAPE_SETTINGS, type ShapeSettings } from './songShapeTables';
import { stripSignature } from './songMixerModel';
import { guardFrozenColumns } from './songFrozenColumns';
import {
  playheadLine,
  rulerRow,
  watchSongPlayhead,
  wirePlayheadDrag,
  wireRulerZoom,
} from './songRuler';
import { CYCLE_TICKS, REGION_SUMMARY, SONG_VIEW, forKind } from './songViewTables';

/** What the pane shows: a part (and, when a block was clicked, which of its regions), a chord event, or nothing. */
export type SongSelection =
  | { readonly kind: 'part'; readonly slot: number; readonly region: number | null }
  | { readonly kind: 'event'; readonly index: number }
  | null;

export interface SongViewState {
  selection: SongSelection;
  /**
   * The Parts selection's pick count (`ctx.parts.picks`) this view last wrote
   * or adopted (windsor#462): a render adopts a pick past it. Seeded when the
   * tab is built, so the first render selects nothing.
   */
  picksSeen: number;
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
  /**
   * The groups whose members are folded away under their header
   * (windsor#615 decision 3), by id. Kept for the session, never written to
   * the document; every group starts open.
   */
  readonly closedGroups: Set<number>;
  /** The lane toolbar's tool and Snap grain in ticks, 0 for Off (windsor#349 decision 1). Kept for the session. */
  automationTool: AutomationTool;
  automationSnap: number;
  /** The Shape tool's last shape, rate, phase and duty (windsor#350 decision 4). Kept for the session. */
  shape: ShapeSettings;
}

/** What the lanes, the pane and the cards they host are handed. */
export interface SongView {
  readonly ctx: AppCtx;
  readonly state: SongViewState;
  /** The Shape tool's range and popover (windsor#350), for this render. */
  readonly shape: ShapeTool;
  songTicks(): number;
  /** One bar of the song's meter, in ticks (windsor#430): what a bar's px on the ruler and in every lane hold. */
  ticksPerBar(): number;
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
 * Its Output is in, with the groups' ids and names (windsor#615 decision 5):
 * a select, never dragged, that moves the part's row between folders.
 */
function laneSignature(ctx: AppCtx, open: ReadonlySet<number>): string {
  const { doc } = ctx.model;
  return JSON.stringify([
    doc.transport.bars,
    doc.transport.loop ?? null,
    doc.harmony,
    (doc.groups ?? []).map((group) => [group.id, group.name]),
    doc.parts.map((part) => [
      part.slot,
      part.name,
      part.strip.output,
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
function renderSongView(body: HTMLElement, ctx: AppCtx, state: SongViewState): ShapeTool {
  body.innerHTML = '';
  // The shared part selection, picked or reset since this view last looked (windsor#462 decisions 3, 4 and 6).
  const pick = { slot: ctx.parts.selected, picks: ctx.parts.picks };
  const slots = ctx.model.doc.parts.map((p) => p.slot);
  const synced = syncSongSelection(state.selection, pick, state.picksSeen, slots);
  state.picksSeen = synced.seen;
  state.selection = validSelection(ctx, synced.selection);
  const scroll = el('div', 'lanes-scroll');
  const lanes = el('div', 'lanes');
  sizeLaneColumn(lanes, state.mixerExpanded);
  guardFrozenColumns(lanes, SONG_VIEW.laneGapPx);
  const line = playheadLine();
  const pane = el('div', 'detail-pane');
  // The Shape tool's range and popover (windsor#350): the popover sits in the tab's body.
  const shape = shapeTool(body, state);
  // The lane toolbar (windsor#349): shown while any part is folded open.
  const toolbar = automationToolbar(
    state,
    () => body,
    () => shape.toolChanged(),
    ticksPerBar(ctx.model.doc.transport.meter),
  );
  scroll.appendChild(lanes);
  body.appendChild(toolbar);
  body.appendChild(scroll);
  syncAutomationTool(body, state);
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
      sizeLaneColumn(lanes, state.mixerExpanded);
      view.paintLanes();
      // The fit reads the grid's width, so it is measured on the new cells.
      refit();
      lanes.querySelector<HTMLElement>('.mix-toggle')?.focus();
    },
  };

  const view: SongView = {
    ctx,
    state,
    shape,
    songTicks: () => songTicksOf(ctx.model.doc),
    ticksPerBar: () => ticksPerBar(ctx.model.doc.transport.meter),
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
      const slot = pickedSlot(state.selection);
      if (slot !== null) {
        ctx.parts.pick(slot);
        state.picksSeen = ctx.parts.picks;
      }
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
      // The folder tracks (windsor#615): a removed group's fold is forgotten, and a folded group's members are not drawn.
      forgetRemovedGroups(state.closedGroups, doc.groups ?? []);
      const shown = visibleRows(songRows(doc), state.closedGroups);
      const rows: HTMLElement[] = [
        headGroup(mixer, rulerRow(doc.transport.bars, state.pxPerBar, doc.transport.meter), brace),
        harmonyGroup(harmonyLaneRow(view)),
        ...bodyGroups(view, shown, fresh),
      ];
      readouts = fresh;
      lanes.replaceChildren(...rows, ...brace.lines, line);
      toolbar.hidden = !shown.some((row) => row.kind === 'part' && state.openParts.has(row.slot));
      readValues(ctx.transport.position());
      // The new blocks start unlit, and the loop marks only a moved tick: light the playing chord now, paused or not.
      markPlayingBlock(lanes, doc, view.songTicks(), ctx.transport.position());
      // The Shape selection on its new lane, or closed when the lane went with the repaint.
      shape.refresh();
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
    ticksPerBar: view.ticksPerBar,
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
  return shape;
}

/** The tab's renderer, keeping its selection across renders — what `main.ts` registers as Song. */
export function songTab(ctx: AppCtx): (body: HTMLElement) => void {
  const state: SongViewState = {
    selection: null,
    picksSeen: ctx.parts.picks,
    pxPerBar: SONG_VIEW.pxPerBar,
    scrollPx: 0,
    floorPxPerBar: null,
    sequencerOpen: true,
    insertsOpen: true,
    paneScrollPx: 0,
    mixerExpanded: false,
    openParts: new Set(),
    closedGroups: new Set(),
    automationTool: DEFAULT_AUTOMATION_TOOL,
    automationSnap: DEFAULT_SNAP_TICKS,
    shape: DEFAULT_SHAPE_SETTINGS,
  };
  // The tool keys (windsor#349): once, on the tab's body, which outlives its renders.
  let keyed: HTMLElement | null = null;
  // The Shape tool of the current render (windsor#350): a render closes the last one's popover.
  let shape: ShapeTool | null = null;
  return (body) => {
    if (keyed !== body) wireToolKeys(body, state, () => shape?.toolChanged());
    keyed = body;
    shape?.close();
    shape = renderSongView(body, ctx, state);
  };
}
