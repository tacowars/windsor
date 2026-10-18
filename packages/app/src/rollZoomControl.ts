/**
 * One Roll card's zoom (windsor#902; record
 * `2026-10-18-roll-zoom-bars-and-duplicate` decisions 1 to 3): the zoom
 * bars (`rollZoomBars.ts`) and the Show item's Loop and Region, over the
 * view's zoom (`rollView.ts`) and `rollZoomModel.ts`'s maths. The bars read
 * and write the notes pane's scroll and the zoom of the view on show; a
 * zoom aims the pane's next restore at the edge it held (`rollViewSpot.ts`)
 * and repaints once a frame. The ruler, the keys, the wheel and the pinch
 * (`rollZoomInput.ts`, windsor#903) write their views through `setTime`
 * and `setRows`, and read the view they start from with `timeView` and
 * `rowView`: the view a move set and no paint has drawn yet, else the one
 * drawn.
 *
 * Which fit Show lights is read from the view drawn and the pane's scroll
 * (`fitsOf`), never from the last button pressed. A fit stays while the
 * view sits on it, so a paint after a resize or a loop change refits it,
 * and goes once a scroll or a zoom leaves it (`settleFit`). Every change
 * a gesture, a bar or a fit makes shows the readout (`rollZoomReadout.ts`)
 * once it is drawn.
 */
import { PPQ } from '@windsor/engine';
import type { RollPanes } from './rollPanes';
import type { RollScene } from './rollScene';
import { type ShownBars, shownBars, slackTicks } from './rollSummary';
import { ROLL_ZOOM_TEXT } from './rollTables';
import { type RollViewKind, type RollZoom, beatPxOf } from './rollView';
import type { RollViewSpot } from './rollViewSpot';
import { type BarAxis, type RollZoomBars, rollZoomBars } from './rollZoomBars';
import {
  type AxisShare,
  type RollFit,
  type RowBounds,
  type RowView,
  type TimeBounds,
  type TimeView,
  type ViewEdge,
  fitsOf,
  rowBoundsOf,
  settleFit,
  spanRows,
  spanTime,
} from './rollZoomModel';
import { RollZoomReadout, octaveText, octavesShown, spanText, timeText } from './rollZoomReadout';

/** What the control reads and writes on its card. */
export interface ZoomControlHost {
  readonly panes: RollPanes;
  readonly spot: RollViewSpot;
  /** The part's zooms, one per view, written in place. */
  readonly zooms: Record<RollViewKind, RollZoom>;
  /** The view on show. */
  kind(): RollViewKind;
  source(): {
    readonly loopTicks: number;
    readonly regionTicks: number;
    readonly barTicks: number;
  };
  /** The scene last drawn. */
  scene(): RollScene | null;
  repaint(): void;
}

/** What the readout says next, once the change is drawn: the axes it names, and where. */
interface Said {
  readonly time: boolean;
  readonly rows: boolean;
  readonly x: number | null;
}

/** One card's zoom: its bars, its Show fits, and the zoom they write. */
export class RollZoomControl {
  readonly bars: RollZoomBars;
  readonly readout: RollZoomReadout;
  private frame = 0;
  /** The views a move set that no paint has drawn yet. */
  private pending: { time: TimeView | null; rows: RowView | null } = { time: null, rows: null };
  private said: Said | null = null;

  constructor(private readonly host: ZoomControlHost) {
    this.bars = rollZoomBars({
      body: host.panes.body,
      share: (axis) => this.share(axis),
      scrollTo: (axis, start) => this.scrollTo(axis, start),
      span: (axis, edge, moved, held) => this.span(axis, edge, { moved, held }),
    });
    this.readout = new RollZoomReadout(host.panes);
  }

  private get zoom(): RollZoom {
    return this.host.zooms[this.host.kind()];
  }

  private set zoom(zoom: RollZoom) {
    this.host.zooms[this.host.kind()] = zoom;
  }

  /** What bounds the time zoom now: the notes pane's width, the region and the loop. */
  timeBounds(): TimeBounds {
    const { loopTicks, regionTicks } = this.host.source();
    return { widthPx: this.host.panes.body.clientWidth, loopTicks, regionTicks };
  }

  /** What bounds the row zoom: the rows drawn, in the notes pane's height; null before a paint. */
  rowBounds(): RowBounds | null {
    const scene = this.host.scene();
    return scene ? rowBoundsOf(scene.rows, this.host.panes.body.clientHeight) : null;
  }

  /** The px per beat the next paint draws at. */
  beatPx(): number {
    return beatPxOf(this.zoom, this.timeBounds());
  }

  /** The row height the next paint draws at. */
  rowPx(): number {
    return this.zoom.rowPx;
  }

  /** The view drawn: its px per beat and the tick at the pane's left edge. */
  private drawn(scene: RollScene): TimeView {
    const left = this.host.panes.body.scrollLeft / scene.pxPerTick;
    return { beatPx: scene.pxPerTick * PPQ, left };
  }

  /** The time view a gesture starts from: the one set and not yet drawn, else the one drawn. */
  timeView(): TimeView | null {
    const scene = this.host.scene();
    return scene && (this.pending.time ?? this.drawn(scene));
  }

  /** The rows a gesture starts from: as `timeView`. */
  rowView(): RowView | null {
    const scene = this.host.scene();
    const top = this.host.panes.body.scrollTop;
    return scene && (this.pending.rows ?? { rowPx: scene.rows.rowPx, top });
  }

  /** Which fits the view drawn sits on, which Show lights. */
  fits(): Record<RollFit, boolean> {
    const scene = this.host.scene();
    const bounds = this.timeBounds();
    if (!scene || !(bounds.widthPx > 0)) {
      return { loop: this.zoom.fit === 'loop', region: this.zoom.fit === 'region' };
    }
    return fitsOf(this.drawn(scene), bounds);
  }

  /** Fit the view to `fit`, from tick 0. */
  show(fit: RollFit): void {
    this.zoom = { ...this.zoom, fit };
    this.host.spot.aim(0, null);
    this.announce('time', null);
    this.host.repaint();
  }

  /**
   * Put the time view at `view`, drawn on the next frame, with the readout
   * at `x` px into the pane, or, `quiet`, without naming time in it.
   */
  setTime(view: TimeView, say: { x?: number | null; quiet?: boolean } = {}): void {
    const fit = settleFit(this.zoom.fit, view, this.timeBounds());
    this.zoom = { ...this.zoom, fit, beatPx: view.beatPx };
    this.host.spot.aim(view.left, null);
    this.pending.time = view;
    if (!say.quiet) this.announce('time', say.x ?? null);
    this.schedule();
  }

  /** Put the rows at `view`, drawn on the next frame; `quiet`, without naming rows in the readout. */
  setRows(view: RowView, quiet = false): void {
    this.zoom = { ...this.zoom, rowPx: view.rowPx };
    this.host.spot.aim(null, view.top);
    this.pending.rows = view;
    if (!quiet) this.announce('rows', null);
    this.schedule();
  }

  /**
   * Keep the fit the view drawn sits on, or let it go with the px per beat
   * it drew at. A view off a fit keeps its own px per beat here, so a
   * scroll that lands while a zoom waits for its frame never undoes it.
   */
  private settle(): void {
    const scene = this.host.scene();
    const bounds = this.timeBounds();
    if (!scene || !(bounds.widthPx > 0)) return;
    const view = this.drawn(scene);
    const fit = settleFit(this.zoom.fit, view, bounds);
    if (fit !== this.zoom.fit) this.zoom = { ...this.zoom, fit, beatPx: view.beatPx };
  }

  /** After a whole paint: settle the fit, draw the maps, place the thumbs and say what changed. */
  painted(scene: RollScene): void {
    this.pending = { time: null, rows: null };
    this.settle();
    this.bars.paint(scene);
    this.speak();
  }

  /** After a scroll: settle the fit and move the thumbs. */
  scrolled(): void {
    this.settle();
    this.bars.place();
  }

  /** The bars the view drawn shows; null before the pane has a width. */
  shown(): ShownBars | null {
    const scene = this.host.scene();
    const { body } = this.host.panes;
    if (!scene || !(body.clientWidth > 0)) return null;
    const { barTicks, regionTicks } = this.host.source();
    const view = {
      left: body.scrollLeft / scene.pxPerTick,
      ticks: body.clientWidth / scene.pxPerTick,
      slack: slackTicks(scene.pxPerTick, barTicks),
    };
    return shownBars(view, barTicks, regionTicks);
  }

  /** Name `axis` in the readout once the change is drawn. */
  private announce(axis: BarAxis, x: number | null): void {
    const was = this.said;
    const time = axis === 'time' || (was?.time ?? false);
    const rows = axis === 'rows' || (was?.rows ?? false);
    this.said = { time, rows, x: x ?? was?.x ?? null };
  }

  /** Show what the view drawn shows, for the axes announced since the last time. */
  private speak(): void {
    const said = this.said;
    const scene = this.host.scene();
    const shown = this.shown();
    if (!said || !scene || !shown) return;
    this.said = null;
    const { body } = this.host.panes;
    const words: string[] = [];
    if (said.time) {
      const ticks =
        body.clientWidth / scene.pxPerTick - slackTicks(scene.pxPerTick, scene.barTicks);
      words.push(timeText(spanText(ticks, scene.barTicks), shown));
    }
    if (said.rows) {
      const view = { top: body.scrollTop, heightPx: body.clientHeight };
      words.push(octaveText(octavesShown(scene.rows.rows, view)));
    }
    this.readout.show(words.join(ROLL_ZOOM_TEXT.join), said.x);
  }

  /** Where the view sits along `axis`, as shares of the region or of the rows. */
  private share(axis: BarAxis): AxisShare {
    const { body } = this.host.panes;
    const scene = this.host.scene();
    const whole = (axis === 'time' ? scene?.width : scene?.rows.height) ?? 0;
    if (!(whole > 0)) return { start: 0, end: 1 };
    const at = axis === 'time' ? body.scrollLeft : body.scrollTop;
    const shown = axis === 'time' ? body.clientWidth : body.clientHeight;
    return { start: at / whole, end: Math.min(1, (at + shown) / whole) };
  }

  private scrollTo(axis: BarAxis, start: number): void {
    const scene = this.host.scene();
    if (!scene) return;
    const { body } = this.host.panes;
    if (axis === 'time') body.scrollLeft = start * scene.width;
    else body.scrollTop = start * scene.rows.height;
    this.announce(axis, null);
    this.speak();
  }

  /** Move one edge of the view to the share `moved` with the other held at `held`. */
  private span(axis: BarAxis, edge: ViewEdge, at: { moved: number; held: number }): void {
    const scene = this.host.scene();
    if (!scene) return;
    const [start, end] = edge === 'start' ? [at.moved, at.held] : [at.held, at.moved];
    const hold: ViewEdge = edge === 'start' ? 'end' : 'start';
    if (axis === 'time') {
      const bounds = this.timeBounds();
      const ticks = bounds.regionTicks;
      this.setTime(spanTime(bounds, { start: start * ticks, end: end * ticks, hold }));
    } else {
      const { body } = this.host.panes;
      // The scene drawn, never the zoom: a move before the repaint has changed the zoom.
      const drawn = { rowPx: scene.rows.rowPx, top: body.scrollTop };
      const bounds = rowBoundsOf(scene.rows, body.clientHeight);
      this.setRows(spanRows(drawn, bounds, { start, end, hold }));
    }
  }

  /** One repaint on the next frame, however many moves come before it. */
  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.host.repaint();
    });
  }
}
