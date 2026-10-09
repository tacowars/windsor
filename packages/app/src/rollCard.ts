/**
 * The Roll device (windsor#602, epic windsor#596; record
 * `2026-10-04-roll-sequencer`, look
 * `docs/research/2026-10-04-piano-roll/roll.html`, approved in windsor#597):
 * the body the Song pane's frame (`sequencerDevice.ts`) puts beside the
 * shared rail, which carries Expand (`rollExpand.ts`) among its tools.
 *
 * One tab, Notes, with the summary at its right; the controls
 * (`rollControls.ts`); and the roll's four panes (`rollPanes.ts`), painted
 * from a `RollScene` (`rollPaint.ts`, `rollNotesPaint.ts`). It edits
 * (windsor#603) through `rollEditing.ts`, whose edit in progress it draws
 * over the document.
 *
 * One playhead loop (`watchPlayhead`) per card: each frame it repaints when
 * the roll, the region or the harmony changed under it, moves the key guide
 * when its chord moved, places the playhead, and reads Rec (`rollRecView.ts`,
 * windsor#663). A resize refits Fit and Fold. The view settings are the
 * part's for the session (`rollView.ts`).
 */
import { partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { DARK, readPlayhead } from './regionPlayhead';
import { type RollControls, rollControls } from './rollControls';
import { type RollEditing, rollEditing } from './rollEditing';
import { type RollExpander, rollExpander } from './rollExpand';
import { chordLabel, tonesAt } from './rollHarmony';
import { guideTick, playingTick, pointerTick, rollPlayhead, standingTick } from './rollGuide';
import {
  type DrawnNote,
  type GuideTargets,
  lightPlayhead,
  paintGuide,
  paintNotes,
} from './rollNotesPaint';
import { markKeys, paintBody, paintHead, paintKeys } from './rollPaint';
import { type RollPanes, rollPanes, syncPanes } from './rollPanes';
import { type RollRecView, rollRecView } from './rollRecView';
import { type TickWindow, rollInstances, rollWindow, windowHolds } from './rollRepeats';
import { nearestRow, rowIndexAt } from './rollRows';
import { type RollScene, centrePitch, rollScene } from './rollScene';
import {
  type RollSource,
  readRollSource,
  regionClock,
  sameInputs,
  sourceKey,
  withDraft,
} from './rollSource';
import { sourceSummary } from './rollSummary';
import {
  ROLL_COLORS,
  ROLL_DRAW_BUDGET,
  ROLL_EMPTY_CENTRE_PITCH,
  ROLL_NOTE,
  ROLL_UNFIT_BEAT_PX,
} from './rollTables';
import {
  type RollViewState,
  type RollZoom,
  beatPxOf,
  fitBeatPx,
  fitTime,
  rollViewOf,
  rowPxOf,
  snapOf,
  zoomRows,
  zoomTime,
} from './rollView';
import { KIND_LABELS } from './sequencerConstants';
import type { DeviceBody } from './sequencerDevice';
import { watchPlayhead } from './stepStrip';

/** The tab bar: Notes, and the summary at its right. */
function tabBar(): { row: HTMLElement; summary: HTMLElement } {
  const row = el('div', 'roll-tabs');
  row.setAttribute('role', 'tablist');
  row.setAttribute('aria-label', 'Roll pages');
  const tab = el('span', 'roll-tab', 'Notes');
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'true');
  const summary = el('span', 'roll-summary');
  row.append(tab, summary);
  return { row, summary };
}

/** Where the view sits, kept across a repaint: the tick at the left edge and the pitch in the middle. */
interface ViewSpot {
  readonly tick: number;
  readonly pitch: number;
}

/** One Roll card: its state, its paint and its loop. */
class RollDevice {
  readonly body = el('div', 'seq-device-body roll-device-body');
  private readonly view: RollViewState;
  private readonly tabs = tabBar();
  private readonly panes: RollPanes;
  private readonly controls: RollControls;
  private readonly expander: RollExpander;
  private readonly editing: RollEditing;
  private readonly rec: RollRecView;
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
  private spot: ViewSpot | null = null;
  private playhead = DARK;

  constructor(
    private readonly ctx: AppCtx,
    private readonly slot: number,
    private readonly region: number | undefined,
  ) {
    this.view = rollViewOf(slot);
    this.source = readRollSource(ctx.model.doc, slot, region);
    this.sourceSeen = sourceKey(this.source);
    for (const [prop, colour] of Object.entries(ROLL_COLORS)) {
      this.body.style.setProperty(prop, colour);
    }
    this.panes = rollPanes(() => this.scrolled());
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
      slot,
      body: this.body,
      title: () => `${partAt(ctx.model.doc, slot)?.name ?? ''} — ${KIND_LABELS.roll}`,
      changed: () => {
        this.spot = null;
        this.paint();
      },
    });
    this.rec = this.recView();
    this.controls = rollControls({
      ctx,
      slot,
      view: this.view,
      zoom: () => this.zoom(),
      zoomTime: (dir) =>
        this.setZoom(dir === 0 ? fitTime(this.zoom()) : zoomTime(this.zoom(), this.fit(), dir)),
      zoomRows: (dir) => this.setZoom(zoomRows(this.zoom(), dir)),
      beatPx: () => this.beatPx(),
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
    });
    this.wire();
    this.paint();
    this.watch();
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
    });
  }

  /** The rail's own button. */
  get tools(): HTMLElement[] {
    return [this.expander.button];
  }

  private zoom(): RollZoom {
    return this.view.zoom[this.expander.isExpanded() ? 'wide' : 'device'];
  }

  private setZoom(zoom: RollZoom): void {
    this.view.zoom[this.expander.isExpanded() ? 'wide' : 'device'] = zoom;
    this.paint();
  }

  private fit(): number {
    const width = this.panes.body.clientWidth;
    return width > 0 ? fitBeatPx(width, this.source.regionTicks) : ROLL_UNFIT_BEAT_PX;
  }

  private beatPx(): number {
    return beatPxOf(this.zoom(), this.fit());
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
    // Fit follows the width and Fold the height; the first layout centres the notes.
    new ResizeObserver(() => this.paint()).observe(panes.body);
    const main = el('div', 'seq-section roll-main');
    main.appendChild(panes.root);
    const page = el('div', 'roll-page');
    page.append(this.controls.root, main);
    this.body.append(this.tabs.row, page);
  }

  private keepSpot(): void {
    const { scene, panes } = this;
    if (!scene || panes.body.clientHeight === 0) return;
    const { rows } = scene.rows;
    const mid = rows[rowIndexAt(rows, panes.body.scrollTop + panes.body.clientHeight / 2)];
    this.spot = { tick: panes.body.scrollLeft / scene.pxPerTick, pitch: mid?.pitch ?? 0 };
  }

  private restoreSpot(): void {
    const { scene, panes } = this;
    if (!scene || panes.body.clientHeight === 0) return;
    const pitch = this.spot?.pitch ?? centrePitch(this.source.notes, ROLL_EMPTY_CENTRE_PITCH);
    const row = nearestRow(scene.rows.rows, pitch);
    const tick = this.spot?.tick ?? 0;
    panes.body.scrollTop = row ? row.top + row.h / 2 - panes.body.clientHeight / 2 : 0;
    panes.body.scrollLeft = tick * scene.pxPerTick;
    syncPanes(panes);
    this.keepSpot();
  }

  /** The ticks the notes pane shows, widened by `margin` screens either side. */
  private viewTicks(scene: RollScene, margin?: number): TickWindow {
    const { body } = this.panes;
    const view = {
      scrollPx: body.scrollLeft,
      widthPx: body.clientWidth,
      pxPerTick: scene.pxPerTick,
      regionTicks: scene.regionTicks,
    };
    return rollWindow(view, margin);
  }

  /** Draw the notes and stems the view's window holds, never every repeat of the region. */
  private paintWindow(): void {
    const { scene, notesLayer } = this;
    if (!scene || !notesLayer) return;
    const ticks = this.viewTicks(scene);
    const instances = rollInstances(scene.notes, {
      loopTicks: scene.loopTicks,
      regionTicks: scene.regionTicks,
      within: ticks,
      minTicks: ROLL_NOTE.minWPx / scene.pxPerTick,
      breaks: scene.spans.map((span) => span.start),
      budget: ROLL_DRAW_BUDGET,
    });
    const selected = new Set(this.editing.editor.selected());
    const notes = paintNotes(this.panes, notesLayer, scene, { instances, selected });
    this.painted = ticks;
    this.drawn = notes.drawn;
    this.lines = [...this.fixedLines, notes.ph];
    if (this.guideTargets) markKeys(this.guideTargets.keys, this.editing.editor.selectedPitches());
  }

  /** A scroll keeps the spot, and redraws the notes once the view leaves what was drawn. */
  private scrolled(): void {
    this.keepSpot();
    const { scene, painted } = this;
    if (!scene || !painted || windowHolds(painted, this.viewTicks(scene, 0))) return;
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
      rowPx: rowPxOf(this.zoom()),
      panePx: panes.body.clientHeight,
      beatPx: this.beatPx(),
    });
    this.scene = scene;
    const head = paintHead(panes, scene);
    const keys = paintKeys(panes, scene);
    const layers = paintBody(panes, scene);
    this.notesLayer = layers.notes;
    this.fixedLines = [head.ph, layers.ph];
    this.guideTargets = { keys, chords: head.chords, corner: panes.corner };
    this.guideKey = '';
    this.rec.summary(sourceSummary(this.source, snapOf(view.snap).label));
    this.restoreSpot();
    this.paintWindow();
    this.controls.refresh();
    this.updateGuide();
    this.light();
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
      attached: () => this.expander.attached(),
      shown: () => this.body.closest('[hidden]') === null,
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
