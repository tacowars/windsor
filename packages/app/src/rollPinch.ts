/**
 * Two fingers on the Roll's notes pane zoom it (windsor#903 decision 4;
 * record `2026-10-18-roll-zoom-bars-and-duplicate` decision 6): their
 * horizontal spread zooms time and their vertical spread the rows, each
 * once the fingers are far enough apart on it, around their midpoint
 * (`rollZoomGestures.ts`'s `stepPinch`, from the views at the pinch's start).
 *
 * One finger stays the notes' own (`rollNoteGestures.ts`; record
 * `2026-10-04-roll-sequencer` decision 8): on empty space it scrolls the
 * pane, the browser's pan, and a tap adds a note. This listens in the
 * capture phase, so it meets a second finger before the notes do: it
 * cancels the edit the first finger began, captures both fingers on the
 * pane, and keeps every event of theirs, and of any finger that lands
 * while they are down, from the notes' gestures until they lift.
 *
 * It runs on pointer events. The page's zoom lock (`pageZoomLock.ts`,
 * record `2026-10-18-the-page-never-zooms`) cancels a `touchmove` that
 * carries more than one touch, which keeps the browser from panning or
 * zooming under the pinch, and the pointer events still arrive.
 */
import type { RollPanes } from './rollPanes';
import type { RollZoomControl } from './rollZoomControl';
import { type PanePoint, type Pinch, startPinch, stepPinch } from './rollZoomGestures';

/** What the pinch reads, zooms and cancels. */
export interface PinchHost {
  readonly panes: RollPanes;
  readonly zoom: RollZoomControl;
  /** Drop the notes' edit in progress, as a cancel does. */
  cancelEdit(): void;
}

/** Two fingers, by pointer id. */
type Pair = readonly [number, number];

/** The pinch's two fingers, and what it works from. */
interface LivePinch {
  readonly ids: Pair;
  pinch: Pinch;
}

/** The pinch on one card's notes pane. */
class RollPinch {
  /** Every finger down on the pane, where it is now. */
  private readonly touches = new Map<number, PanePoint>();
  private live: LivePinch | null = null;
  private readonly onBlur = (): void => this.end();

  constructor(private readonly host: PinchHost) {
    const { body } = host.panes;
    const capture = { capture: true };
    body.addEventListener('pointerdown', (e) => this.down(e), capture);
    body.addEventListener('pointermove', (e) => this.moved(e), capture);
    body.addEventListener('pointerup', (e) => this.lift(e), capture);
    body.addEventListener('pointercancel', (e) => this.lift(e), capture);
  }

  private local(e: PointerEvent): PanePoint {
    const box = this.host.panes.body.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  private fingers(ids: Pair): [PanePoint, PanePoint] | null {
    const a = this.touches.get(ids[0]);
    const b = this.touches.get(ids[1]);
    return a && b ? [a, b] : null;
  }

  private down(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    // The first finger on a bare screen: no finger seen before is still down.
    if (e.isPrimary) this.touches.clear();
    this.touches.set(e.pointerId, this.local(e));
    const ids = [...this.touches.keys()];
    const pair: Pair | null = ids.length === 2 ? [ids[0] as number, ids[1] as number] : null;
    if (this.live || (pair && this.begin(pair))) e.stopImmediatePropagation();
  }

  /** Start a pinch of `ids` over the views drawn: the notes' edit dropped, both fingers captured. */
  private begin(ids: Pair): boolean {
    const { zoom, panes } = this.host;
    const time = zoom.timeView();
    const rows = zoom.rowView();
    const timeBounds = zoom.timeBounds();
    const rowBounds = zoom.rowBounds();
    const at = this.fingers(ids);
    if (!time || !rows || !rowBounds || !at || !(timeBounds.widthPx > 0)) return false;
    this.host.cancelEdit();
    this.live = { ids, pinch: startPinch(at, { time, rows, timeBounds, rowBounds }) };
    for (const id of ids) {
      try {
        panes.body.setPointerCapture(id);
      } catch {
        // A pointer the browser does not track: the pinch runs on the pane's own events.
      }
    }
    window.addEventListener('blur', this.onBlur);
    return true;
  }

  private moved(e: PointerEvent): void {
    if (!this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, this.local(e));
    const { live } = this;
    if (!live) return;
    e.stopImmediatePropagation();
    const at = live.ids.includes(e.pointerId) ? this.fingers(live.ids) : null;
    if (!at) return;
    const step = stepPinch(live.pinch, at);
    live.pinch = step.pinch;
    // The readout names the axes that zoom; a two-finger pan, time's bars shown.
    const { zooms } = step;
    this.host.zoom.setRows(step.rows, !zooms.rows);
    const quiet = zooms.rows && !zooms.time;
    this.host.zoom.setTime(step.time, { x: (at[0].x + at[1].x) / 2, quiet });
  }

  private lift(e: PointerEvent): void {
    if (!this.touches.delete(e.pointerId) || !this.live) return;
    e.stopImmediatePropagation();
    if (this.live.ids.includes(e.pointerId)) this.end();
  }

  /** The pinch is over: its fingers released, the views where its last move put them. */
  private end(): void {
    const was = this.live;
    this.live = null;
    window.removeEventListener('blur', this.onBlur);
    const { body } = this.host.panes;
    for (const id of was?.ids ?? []) {
      if (body.hasPointerCapture(id)) body.releasePointerCapture(id);
    }
  }
}

/** Wire the pinch on one card's notes pane. */
export function rollPinch(host: PinchHost): void {
  new RollPinch(host);
}
