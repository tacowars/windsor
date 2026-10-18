/**
 * One Roll card's zoom (windsor#902; record
 * `2026-10-18-roll-zoom-bars-and-duplicate` decisions 1 to 3): the zoom
 * bars (`rollZoomBars.ts`) and the Show item's Loop and Region, over the
 * view's zoom (`rollView.ts`) and `rollZoomModel.ts`'s maths. The bars read
 * and write the notes pane's scroll and the zoom of the view on show; a
 * zoom aims the pane's next restore at the edge it held (`rollViewSpot.ts`)
 * and repaints once a frame.
 *
 * Which fit Show lights is read from the view drawn and the pane's scroll
 * (`fitsOf`), never from the last button pressed. A fit stays while the
 * view sits on it, so a paint after a resize or a loop change refits it,
 * and goes once a scroll or a zoom leaves it (`settleFit`).
 */
import { PPQ } from '@windsor/engine';
import type { RollPanes } from './rollPanes';
import type { RollScene } from './rollScene';
import { type RollViewKind, type RollZoom, beatPxOf } from './rollView';
import type { RollViewSpot } from './rollViewSpot';
import { type BarAxis, type RollZoomBars, rollZoomBars } from './rollZoomBars';
import {
  type AxisShare,
  type RollFit,
  type TimeBounds,
  type TimeView,
  type ViewEdge,
  fitsOf,
  rowBoundsOf,
  settleFit,
  spanRows,
  spanTime,
} from './rollZoomModel';

/** What the control reads and writes on its card. */
export interface ZoomControlHost {
  readonly panes: RollPanes;
  readonly spot: RollViewSpot;
  /** The part's zooms, one per view, written in place. */
  readonly zooms: Record<RollViewKind, RollZoom>;
  /** The view on show. */
  kind(): RollViewKind;
  source(): { readonly loopTicks: number; readonly regionTicks: number };
  /** The scene last drawn. */
  scene(): RollScene | null;
  repaint(): void;
}

/** One card's zoom: its bars, its Show fits, and the zoom they write. */
export class RollZoomControl {
  readonly bars: RollZoomBars;
  private frame = 0;

  constructor(private readonly host: ZoomControlHost) {
    this.bars = rollZoomBars({
      body: host.panes.body,
      share: (axis) => this.share(axis),
      scrollTo: (axis, start) => this.scrollTo(axis, start),
      span: (axis, edge, moved, held) => this.span(axis, edge, { moved, held }),
    });
  }

  private get zoom(): RollZoom {
    return this.host.zooms[this.host.kind()];
  }

  private set zoom(zoom: RollZoom) {
    this.host.zooms[this.host.kind()] = zoom;
  }

  private bounds(): TimeBounds {
    const { loopTicks, regionTicks } = this.host.source();
    return { widthPx: this.host.panes.body.clientWidth, loopTicks, regionTicks };
  }

  /** The px per beat the next paint draws at. */
  beatPx(): number {
    return beatPxOf(this.zoom, this.bounds());
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

  /** Which fits the view drawn sits on, which Show lights. */
  fits(): Record<RollFit, boolean> {
    const scene = this.host.scene();
    const bounds = this.bounds();
    if (!scene || !(bounds.widthPx > 0)) {
      return { loop: this.zoom.fit === 'loop', region: this.zoom.fit === 'region' };
    }
    return fitsOf(this.drawn(scene), bounds);
  }

  /** Fit the view to `fit`, from tick 0. */
  show(fit: RollFit): void {
    this.zoom = { ...this.zoom, fit };
    this.host.spot.aim(0, null);
    this.host.repaint();
  }

  /**
   * Keep the fit the view drawn sits on, or let it go with the px per beat
   * it drew at. A view off a fit keeps its own px per beat here, so a
   * scroll that lands while a zoom waits for its frame never undoes it.
   */
  private settle(): void {
    const scene = this.host.scene();
    const bounds = this.bounds();
    if (!scene || !(bounds.widthPx > 0)) return;
    const view = this.drawn(scene);
    const fit = settleFit(this.zoom.fit, view, bounds);
    if (fit !== this.zoom.fit) this.zoom = { ...this.zoom, fit, beatPx: view.beatPx };
  }

  /** After a whole paint: settle the fit, draw the maps and place the thumbs. */
  painted(scene: RollScene): void {
    this.settle();
    this.bars.paint(scene);
  }

  /** After a scroll: settle the fit and move the thumbs. */
  scrolled(): void {
    this.settle();
    this.bars.place();
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
  }

  /** Move one edge of the view to the share `moved` with the other held at `held`. */
  private span(axis: BarAxis, edge: ViewEdge, at: { moved: number; held: number }): void {
    const scene = this.host.scene();
    if (!scene) return;
    const [start, end] = edge === 'start' ? [at.moved, at.held] : [at.held, at.moved];
    const hold: ViewEdge = edge === 'start' ? 'end' : 'start';
    if (axis === 'time') {
      const bounds = this.bounds();
      const ticks = bounds.regionTicks;
      const view = spanTime(bounds, { start: start * ticks, end: end * ticks, hold });
      const fit = settleFit(this.zoom.fit, view, bounds);
      this.zoom = { ...this.zoom, fit, beatPx: view.beatPx };
      this.host.spot.aim(view.left, null);
    } else {
      const { body } = this.host.panes;
      // The scene drawn, never the zoom: a move before the repaint has changed the zoom.
      const drawn = { rowPx: scene.rows.rowPx, top: body.scrollTop };
      const bounds = rowBoundsOf(scene.rows, body.clientHeight);
      const view = spanRows(drawn, bounds, { start, end, hold });
      this.zoom = { ...this.zoom, rowPx: view.rowPx };
      this.host.spot.aim(null, view.top);
    }
    this.schedule();
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
