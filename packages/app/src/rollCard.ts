/**
 * The Roll device (windsor#602, epic windsor#596; record
 * `2026-10-04-roll-sequencer`, look
 * `docs/research/2026-10-04-piano-roll/roll.html`, approved in windsor#597):
 * the body the Song pane's frame (`sequencerDevice.ts`) puts beside the
 * shared rail, which carries Expand (`rollExpand.ts`) among its tools.
 *
 * Two tabs, Notes · Envelopes, with the summary at their right
 * (`rollEnvelopeTabs.ts`); the controls (`rollControls.ts`); and the
 * roll's four panes (`rollPanes.ts`), painted from a `RollScene`
 * (`rollPaint.ts`, `rollNotesPaint.ts`). It edits (windsor#603) through
 * `rollEditing.ts`, whose edit in progress it draws over the document. The
 * lane under the notes shows Vel, Acc or Rat by the corner's tabs
 * (`rollLaneTabs.ts`, windsor#754), and the notes carry their marks. The
 * Envelopes tab (windsor#707) is `rollEnvelopeMode.ts`: its column, the
 * picker and the envelope over the notes.
 *
 * One playhead loop (`watchPlayhead`) per card: each frame it repaints when
 * the roll, the region or the harmony changed under it, moves the key guide
 * when its chord moved, places the playhead, and reads Rec (`rollRecView.ts`,
 * windsor#663). A resize refits a view on a fit and Fold, and the pane
 * keeps its spot across a repaint (`rollViewSpot.ts`). The notes pane zooms
 * by its zoom bars and the Show item's fits (`rollZoomControl.ts`,
 * windsor#902), and by its ruler, its keys, the wheel and a pinch
 * (`rollZoomInput.ts`, `rollPinch.ts`, windsor#903), over
 * `rollZoomModel.ts`'s maths; the summary leads with the bars it shows.
 * The view settings
 * are the part's for the session (`rollView.ts`), and so is where the
 * Expanded view sat.
 */
import { partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { patternOf } from './partEdits';
import { DARK, readPlayhead } from './regionPlayhead';
import { type RollControls, rollControls } from './rollControls';
import { type RollEditing, rollEditing } from './rollEditing';
import { RollEnvelopeMode } from './rollEnvelopeMode';
import { rollTabs } from './rollEnvelopeTabs';
import { type RollExpander, rollExpander } from './rollExpand';
import { chordLabel, tonesAt } from './rollHarmony';
import { rollLaneTabs } from './rollLaneTabs';
import { guideTick, playingTick, pointerTick, rollPlayhead, standingTick } from './rollGuide';
import {
  type DrawnNote,
  type GuideTargets,
  lightPlayhead,
  paintGuide,
  paintNotes,
} from './rollNotesPaint';
import { markKeys, paintBody, paintHead, paintKeys } from './rollPaint';
import { type RollPanes, rollPanes } from './rollPanes';
import { rollPinch } from './rollPinch';
import { rollMetronome } from './rollMetronome';
import { type RollRecView, rollRecView } from './rollRecView';
import { type TickWindow, rollInstances, windowHolds } from './rollRepeats';
import { type RollScene, rollScene } from './rollScene';
import {
  type RollSource,
  readRollSource,
  regionClock,
  sameInputs,
  sourceKey,
  withDraft,
} from './rollSource';
import { sourceSummary } from './rollSummary';
import { ROLL_COLORS, ROLL_DRAW_BUDGET, ROLL_NOTE } from './rollTables';
import { type RollViewState, rollViewOf, snapOf } from './rollView';
import { RollViewSpot } from './rollViewSpot';
import { RollZoomControl } from './rollZoomControl';
import { rollZoomInput } from './rollZoomInput';
import { KIND_LABELS } from './sequencerConstants';
import type { DeviceBody } from './sequencerDevice';
import { watchPlayhead } from './stepStrip';

/** One Roll card: its state, its paint and its loop. */
class RollDevice {
  readonly body = el('div', 'seq-device-body roll-device-body');
  private readonly view: RollViewState;
  private readonly tabs = rollTabs();
  private readonly panes: RollPanes;
  private readonly controls: RollControls;
  private readonly expander: RollExpander;
  private readonly editing: RollEditing;
  private readonly rec: RollRecView;
  private readonly envelopes: RollEnvelopeMode;
  private source: RollSource;
  private sourceSeen: string;
  private scene: RollScene | null = null;
  private drawn: DrawnNote[] = [];
  private lines: HTMLElement[] = [];
  /** The notes' layer, and the playheads in the ruler and the notes, from the last whole paint. */
  private notesLayer: HTMLElement | null = null;
  private fixedLines: HTMLElement[] = [];
  /** The ticks the notes and stems are drawn for. */
  private painted: TickWindow | null = null;
  private guideTargets: GuideTargets | null = null;
  private guideKey = '';
  private hover: number | null = null;
  private readonly spot: RollViewSpot;
  private readonly zoom: RollZoomControl;
  private playhead = DARK;

  constructor(
    private readonly ctx: AppCtx,
    private readonly slot: number,
    private readonly region: number | undefined,
  ) {
    this.view = rollViewOf(slot);
    this.source = readRollSource(ctx.model.doc, slot, region);
    this.sourceSeen = sourceKey(this.source);
    for (const [prop, colour] of Object.entries(ROLL_COLORS))
      this.body.style.setProperty(prop, colour);
    this.panes = rollPanes(() => this.scrolled());
    this.spot = new RollViewSpot(this.panes);
    this.zoom = new RollZoomControl({
      panes: this.panes,
      spot: this.spot,
      zooms: this.view.zoom,
      kind: () => (this.expander.isExpanded() ? 'wide' : 'device'),
      source: () => this.source,
      scene: () => this.scene,
      repaint: () => this.paint(),
    });
    this.editing = rollEditing({
      ctx,
      slot,
      region,
      body: this.body,
      panes: this.panes,
      view: this.view,
      scene: () => this.scene,
      source: () => this.source,
      previewNotes: () => this.previewNotes(),
      repaint: () => this.paint(),
    });
    this.expander = rollExpander({
      ctx,
      slot,
      region,
      body: this.body,
      title: () => `${partAt(ctx.model.doc, slot)?.name ?? ''} — ${KIND_LABELS.roll}`,
      holds: () => {
        const there = region === undefined || partAt(ctx.model.doc, slot)?.regions[region];
        return Boolean(there) && patternOf(ctx.model.doc, slot, region)?.kind === 'roll';
      },
      // Open wide at the part's own wide spot (windsor#873 decision 4); back in the pane, centred.
      changed: (expanded) => {
        this.envelopes.closePopovers();
        this.spot.startFrom(expanded ? this.view.wideSpot : null);
        this.paint();
      },
    });
    this.rec = this.recView();
    this.controls = this.controlsView();
    this.envelopes = this.envelopeMode();
    this.wire();
    this.paint();
    this.watch();
  }

  /** The controls, once the editor and Rec are built. */
  private controlsView(): RollControls {
    return rollControls({
      ctx: this.ctx,
      slot: this.slot,
      region: this.region,
      view: this.view,
      fits: () => this.zoom.fits(),
      show: (fit) => this.zoom.show(fit),
      ticks: () => ({
        loop: this.source.loopTicks,
        region: this.source.regionTicks,
        bar: this.source.barTicks,
      }),
      repaint: () => this.paint(),
      stepLoop: (dir) => this.editing.stepLoop(dir),
      selectedCount: () => this.editing.editor.selected().length,
      quantise: () => this.editing.quantise(),
      rec: this.rec.control,
      metronome: rollMetronome(this.ctx),
    });
  }

  /** Rec on this device (windsor#663). */
  private recView(): RollRecView {
    return rollRecView({
      ctx: this.ctx,
      slot: this.slot,
      panes: this.panes,
      summary: this.tabs.summary,
      source: () => this.source,
      scene: () => this.scene,
      layer: () => this.notesLayer,
      repaint: () => this.paint(),
    });
  }

  /** The Envelopes tab on this device (windsor#707), once the controls and the editor are built. */
  private envelopeMode(): RollEnvelopeMode {
    return new RollEnvelopeMode({
      ctx: this.ctx,
      slot: this.slot,
      region: this.region,
      body: this.body,
      panes: this.panes,
      view: this.view,
      tabs: this.tabs,
      controls: this.controls,
      editor: this.editing.editor,
      attached: () => this.expander.attached(),
      scene: () => this.scene,
    });
  }

  /** The rail's own button. */
  get tools(): HTMLElement[] {
    return [this.expander.button];
  }

  /** Redraw the notes from the edit in progress or a new selection, on the rows already drawn. */
  private previewNotes(): void {
    if (!this.scene) return;
    this.scene = { ...this.scene, notes: this.editing.editor.current().notes };
    this.paintWindow();
    this.controls.refresh();
    this.light();
  }

  private wire(): void {
    const { panes } = this;
    panes.body.addEventListener('pointermove', (e) => {
      if (!this.scene) return;
      const x = e.clientX - panes.canvas.getBoundingClientRect().left;
      this.hover = pointerTick(x, this.scene.pxPerTick, this.source.regionTicks);
      this.updateGuide();
    });
    panes.body.addEventListener('pointerleave', () => {
      this.hover = null;
      this.updateGuide();
    });
    rollLaneTabs(panes.vcorner, this.view, () => this.previewNotes());
    panes.root.append(this.zoom.bars.time, this.zoom.bars.rows, this.zoom.readout.root);
    rollZoomInput({ panes, zoom: this.zoom });
    rollPinch({ panes, zoom: this.zoom, cancelEdit: () => this.editing.cancelPress() });
    // A fit follows the width and Fold the height; the first layout centres the notes.
    new ResizeObserver(() => this.paint()).observe(panes.body);
    const main = el('div', 'seq-section roll-main');
    main.appendChild(panes.root);
    const page = el('div', 'roll-page');
    page.append(this.controls.root, main);
    this.body.append(this.tabs.row, page);
  }

  /** Draw the notes and stems the view's window holds, never every repeat of the region. */
  private paintWindow(): void {
    const { scene, notesLayer } = this;
    if (!scene || !notesLayer) return;
    const ticks = this.spot.ticks(scene);
    const instances = rollInstances(scene.notes, {
      loopTicks: scene.loopTicks,
      regionTicks: scene.regionTicks,
      within: ticks,
      minTicks: ROLL_NOTE.minWPx / scene.pxPerTick,
      breaks: scene.spans.map((span) => span.start),
      budget: ROLL_DRAW_BUDGET,
    });
    const selected = new Set(this.editing.editor.selected());
    const lane = this.view.lane;
    const notes = paintNotes(this.panes, notesLayer, scene, { instances, selected, lane });
    this.painted = ticks;
    this.drawn = notes.drawn;
    this.lines = [...this.fixedLines, notes.ph];
    if (this.guideTargets) markKeys(this.guideTargets.keys, this.editing.editor.selectedPitches());
  }

  /** The spot the pane sits at, kept as the part's wide spot while open wide. */
  private keepWide(): void {
    if (this.expander.isExpanded()) this.view.wideSpot = this.spot.kept;
  }

  /** A scroll keeps the spot, and redraws the notes once the view leaves what was drawn. */
  private scrolled(): void {
    this.spot.keep(this.scene);
    this.keepWide();
    this.zoom.scrolled();
    this.summarize();
    this.controls.refreshShow();
    this.envelopes.scrolled();
    const { scene, painted } = this;
    if (!scene || !painted || windowHolds(painted, this.spot.ticks(scene, 0))) return;
    this.paintWindow();
    this.light();
  }

  /** Draw the whole roll from the document and the view. */
  private paint(): void {
    const { panes, view } = this;
    const read = readRollSource(this.ctx.model.doc, this.slot, this.region);
    this.sourceSeen = sourceKey(read);
    this.source = withDraft(read, this.editing.editor.drafting());
    const scene = rollScene({
      ...this.source,
      snapTicks: snapOf(view.snap).ticks,
      keys: view.keys,
      fold: view.fold,
      rowPx: this.zoom.rowPx(),
      panePx: panes.body.clientHeight,
      beatPx: this.zoom.beatPx(),
      held: this.rec.heldPitches(),
    });
    this.scene = scene;
    const head = paintHead(panes, scene);
    const keys = paintKeys(panes, scene);
    const layers = paintBody(panes, scene);
    this.notesLayer = layers.notes;
    this.fixedLines = [head.ph, layers.ph];
    this.guideTargets = { keys, chords: head.chords, corner: panes.corner };
    this.guideKey = '';
    this.spot.restore(this.scene, this.source.notes);
    this.keepWide();
    this.zoom.painted(scene);
    this.summarize();
    this.paintWindow();
    this.controls.refresh();
    this.envelopes.paint();
    this.updateGuide();
    this.light();
  }

  /** The summary, led by the bars the notes pane shows (windsor#903 decision 7). */
  private summarize(): void {
    const snap = snapOf(this.view.snap).label;
    this.rec.summary(sourceSummary(this.source, snap, this.zoom.shown()));
  }

  /** Tint the keys for the guide's chord, when it moved. */
  private updateGuide(): void {
    const { scene, guideTargets, source } = this;
    if (!scene || !guideTargets) return;
    const clock = regionClock(this.ctx, this.slot, source);
    const guide = guideTick({
      playing: playingTick(clock, this.ctx.transport.running),
      pointer: this.hover,
      standing: standingTick(clock),
    });
    const at = source.regionStart + guide.tick;
    const { chord, tones } = tonesAt(source.harmony, source.songTicks, at);
    const bar = Math.floor(guide.tick / source.barTicks) + 1;
    const block = scene.spans.findIndex((s) => guide.tick >= s.start && guide.tick < s.end);
    const key = `${chord?.index ?? -1}|${bar}|${block}`;
    if (key === this.guideKey) return;
    this.guideKey = key;
    paintGuide(guideTargets, { tones, name: chordLabel(source.harmony, chord), block, bar });
  }

  private light(): void {
    if (!this.scene) return;
    lightPlayhead(this.lines, this.drawn, readPlayhead(this.playhead), this.scene.pxPerTick);
  }

  /** The card's one loop: a repaint when the document moved under it, the guide, the playhead. */
  private watch(): void {
    let restored = false;
    watchPlayhead({
      attached: () => this.envelopes.keepPopovers(this.expander.attached()),
      shown: () => this.envelopes.keepPopovers(this.body.closest('[hidden]') === null),
      repaintIf: () => {
        if (!restored) {
          restored = true;
          this.expander.restore();
        }
        const next = readRollSource(this.ctx.model.doc, this.slot, this.region);
        if (!sameInputs(next, this.source)) {
          if (sourceKey(next) === this.sourceSeen)
            this.source = withDraft(next, this.editing.editor.drafting());
          else this.paint();
        }
        this.updateGuide();
        this.rec.frame();
      },
      playheadAt: () =>
        rollPlayhead(regionClock(this.ctx, this.slot, this.source), this.ctx.transport.running),
      mark: (tick) => {
        this.playhead = tick;
        this.light();
      },
    });
  }
}

/** The device body for a `roll` part's region `region`. */
export function rollCard(ctx: AppCtx, slot: number, region?: number): DeviceBody {
  const device = new RollDevice(ctx, slot, region);
  return { body: device.body, fit: 'fixed', tools: device.tools, className: 'roll-device' };
}
