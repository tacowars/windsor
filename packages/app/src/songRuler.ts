/**
 * The Song view's bar ruler and its one playhead line (#709 decision 1 and
 * 5): `transport.bars` bars at the view's px-per-bar with beat ticks, and a
 * line through every lane placed from the transport's audible tick by
 * `stepStrip.ts`'s one loop — `watchPlayhead`, the way every card lights
 * its cells. The line reads `ctx.transport.position()` whether or not the
 * transport runs, so a paused song shows where it will resume and ■ puts it
 * back on bar 1.
 *
 * The ruler is also the view's zoom and scroll handle (windsor#8): press
 * and drag, up to zoom in and down to zoom out around the pressed bar, left
 * and right to drag the arrangement — the maths is `songZoomModel.ts`. A
 * press released without moving changes nothing. The loop has its own
 * strip under the ruler (`loopBrace.ts`, windsor#30), so no press on the
 * ruler ever edits it. The zoom stops at the fit, the
 * scale at which the whole song fills the window (windsor#21), and a
 * double-click returns to it at bar 1; a resize or a Bars change refits.
 *
 * While the transport is stopped or paused the line itself is a handle
 * (windsor#102): its `bar.beat.sixteenth` label takes the press, brightens
 * the line on hover, and a drag moves the line to the nearest bar line and
 * seeks the transport there on release (`playheadDrag.ts` holds the rules).
 * While it plays the label takes no press, so the ruler under it zooms as
 * before.
 */
import { TICKS_PER_BAR } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import type { PlayheadDrag, PlayheadDragEvent } from './playheadDrag';
import { barTick, canDragPlayhead, pressStartsDrag, stepPlayheadDrag } from './playheadDrag';
import { watchPlayhead } from './stepStrip';
import { formatPosition } from './transportModel';
import { beatTickPx, rulerLabelEvery, rulerLabels, timelineLeftCss } from './songViewTables';
import type {
  RulerDrag,
  RulerDragEvent,
  SongZoom,
  ZoomBounds,
  ZoomDragStart,
} from './songZoomModel';
import { clampScroll, fittedScale, followFit, stepRulerDrag, zoomToFit } from './songZoomModel';

/**
 * The name-column cell and the ruler for `bars` bars at `pxPerBar`: one
 * `.ruler-bar` per bar, labelled (every n-th bar once the bars are too narrow
 * for every label), with three beat ticks while every bar is labelled.
 */
export function rulerRow(bars: number, pxPerBar: number): [HTMLElement, HTMLElement] {
  const name = el('div', 'lane-name ruler-name');
  name.appendChild(el('small', '', 'bar · beat'));
  const ruler = el('div', 'ruler');
  ruler.title = 'drag up or down to zoom, left or right to scroll · double-click to fit the song';
  const every = rulerLabelEvery(pxPerBar);
  const beats = every === 1 ? beatTickPx(pxPerBar) : [];
  rulerLabels(bars).forEach((label, i) => {
    const bar = el('div', 'ruler-bar');
    bar.style.width = `${pxPerBar}px`;
    if (i % every === 0) bar.appendChild(el('span', '', label));
    for (const px of beats) {
      const tick = el('i');
      tick.style.left = `${px}px`;
      bar.appendChild(tick);
    }
    ruler.appendChild(bar);
  });
  return [name, ruler];
}

/** The playhead line, with its `bar.beat.sixteenth` label. */
export function playheadLine(): HTMLElement {
  const line = el('span', 'ph-line');
  line.appendChild(el('i', '', formatPosition(0, 0)));
  return line;
}

/**
 * Put the line on `tick`, past the name and mixer columns. Its px follow the lanes'
 * `--bar`, so a zoom moves the line with the regions even while the
 * transport stands still and the loop has no new tick to mark.
 */
export function placePlayhead(line: HTMLElement, tick: number, songTicks: number): void {
  const songTick = songTicks > 0 ? ((tick % songTicks) + songTicks) % songTicks : 0;
  line.style.left = timelineLeftCss(songTick / TICKS_PER_BAR);
  const label = line.firstChild;
  if (label) label.textContent = formatPosition(tick, songTicks);
}

export interface RulerZoom {
  /** The horizontal scroll container around the lanes. */
  scroll: HTMLElement;
  /** The lanes grid: it outlives a repaint, so it holds the pointer capture while the ruler is redrawn. */
  lanes: HTMLElement;
  /**
   * The view's current zoom and scroll, which the drag rewrites, and the
   * fit last measured — the zoom's floor, which a view sitting on it follows.
   */
  state: { pxPerBar: number; scrollPx: number; floorPxPerBar: number | null };
  bars(): number;
  /** Redraw the lanes at `state.pxPerBar`. */
  repaint(): void;
}

/** What the scroll clamps against, measured at the press: the content besides the bars is padding, names, gap and the `+` tile. */
function measureBounds(zoom: RulerZoom, pxPerBar: number): ZoomBounds {
  const style = getComputedStyle(zoom.scroll);
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const bars = zoom.bars();
  return {
    bars,
    viewportPx: zoom.scroll.clientWidth,
    chromePx: padding + zoom.lanes.scrollWidth - bars * pxPerBar,
  };
}

/** Set the view's zoom and scroll, repainting the lanes only when the scale changed. */
function applyZoom(zoom: RulerZoom, view: SongZoom): void {
  const { scroll, state } = zoom;
  if (view.pxPerBar !== state.pxPerBar) {
    state.pxPerBar = view.pxPerBar;
    zoom.repaint();
  }
  scroll.scrollLeft = view.scrollPx;
  state.scrollPx = scroll.scrollLeft;
}

/**
 * Re-measure the fit and keep the zoom on it (windsor#21): a view at the old
 * fit follows the new one, any other is clamped up to it. Nothing while the
 * view has no width (its tab hidden).
 */
function refit(zoom: RulerZoom): void {
  const { state } = zoom;
  const bounds = measureBounds(zoom, state.pxPerBar);
  if (!(bounds.viewportPx > 0)) return;
  const scale = fittedScale(bounds);
  const pxPerBar = followFit(state.pxPerBar, state.floorPxPerBar, scale);
  state.floorPxPerBar = scale.minPxPerBar;
  applyZoom(zoom, { pxPerBar, scrollPx: clampScroll(zoom.scroll.scrollLeft, bounds, pxPerBar) });
}

/** The view's zoom handle: `refit` after anything that may move the fit besides a resize, which it follows itself. */
export interface RulerZoomHandle {
  refit(): void;
}

/**
 * Wire the ruler: a drag zooms (vertical, around the pressed bar, down to the
 * fit) and scrolls (horizontal) in one gesture; a double-click fits; a
 * resize of the scroll container refits. The drag is `stepRulerDrag`'s state
 * machine over one set of listeners: the lanes (which outlive the ruler's
 * repaint) capture the pointer at the press, and a release, a cancel, a lost
 * capture, a window blur or a move with the button up ends it, so no hover
 * after a missed release zooms. The capture retargets the clicks to the
 * lanes, so the double-click is placed by where it lands, not by its target.
 */
export function wireRulerZoom(zoom: RulerZoom): RulerZoomHandle {
  const { lanes, scroll, state } = zoom;
  let drag: RulerDrag | null = null;
  const onBlur = (): void => step({ type: 'blur' });
  const release = (pointerId: number): void => {
    window.removeEventListener('blur', onBlur);
    if (lanes.hasPointerCapture(pointerId)) lanes.releasePointerCapture(pointerId);
  };
  const step = (event: RulerDragEvent): void => {
    const was = drag;
    const next = stepRulerDrag(drag, event);
    drag = next.drag;
    if (next.view) applyZoom(zoom, next.view);
    if (was && !drag) release(was.pointerId);
  };
  lanes.addEventListener('pointerdown', (down) => {
    const ruler = down.target instanceof Element ? down.target.closest('.ruler') : null;
    if (down.button !== 0 || !(ruler instanceof HTMLElement)) return;
    down.preventDefault();
    if (drag) step({ type: 'cancel', pointerId: drag.pointerId });
    const start: ZoomDragStart = {
      pxPerBar: state.pxPerBar,
      scrollPx: scroll.scrollLeft,
      pointerPx: down.clientX - ruler.getBoundingClientRect().left,
    };
    const bounds = measureBounds(zoom, start.pxPerBar);
    const { pointerId, clientX: originX, clientY: originY } = down;
    drag = { pointerId, originX, originY, start, bounds, scale: fittedScale(bounds), moved: false };
    try {
      lanes.setPointerCapture(pointerId);
    } catch {
      // A pointer the browser does not track: the drag still runs on the lanes' own events.
    }
    window.addEventListener('blur', onBlur);
  });
  lanes.addEventListener('pointermove', (e) => {
    const { pointerId, buttons, clientX, clientY } = e;
    step({ type: 'move', pointerId, buttons, clientX, clientY });
  });
  lanes.addEventListener('pointerup', (e) => step({ type: 'up', pointerId: e.pointerId }));
  lanes.addEventListener('pointercancel', (e) => step({ type: 'cancel', pointerId: e.pointerId }));
  lanes.addEventListener('lostpointercapture', (e) =>
    step({ type: 'lost', pointerId: e.pointerId }),
  );
  lanes.addEventListener('dblclick', (e) => {
    // The playhead's handle sits over the ruler: a double-click on it is two presses on the line, not a fit.
    const onLine = e.target instanceof Element && e.target.closest('.ph-line') !== null;
    if (onLine || !onRuler(lanes, e)) return;
    // Both presses have released by now; end anything a lost event left live before fitting.
    step({ type: 'blur' });
    applyZoom(zoom, zoomToFit(measureBounds(zoom, state.pxPerBar)));
  });
  const observer = new ResizeObserver(() => {
    if (scroll.isConnected) refit(zoom);
    else observer.disconnect();
  });
  observer.observe(scroll);
  return { refit: () => refit(zoom) };
}

/** Whether a click landed on the ruler, by position: the drag's capture makes the lanes its target. */
function onRuler(lanes: HTMLElement, e: MouseEvent): boolean {
  const rect = lanes.querySelector('.ruler')?.getBoundingClientRect();
  if (!rect) return false;
  const { clientX: x, clientY: y } = e;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export interface PlayheadDragWire {
  ctx: AppCtx;
  /** The lanes grid, which holds the ruler the pointer is measured against. */
  lanes: HTMLElement;
  /** The line from `playheadLine`; its label is the handle. */
  line: HTMLElement;
  /** The view's zoom, read at every move. */
  pxPerBar(): number;
  bars(): number;
  songTicks(): number;
  /** Called with the transport's position once a drag ends: the harmony lane lights its block. */
  onTick(tick: number): void;
}

/** The drag as the view's playhead loop sees it. */
export interface PlayheadDragHandle {
  /** A drag is in progress: the loop leaves the line where the pointer put it. */
  readonly dragging: boolean;
  /** Per frame: show the grab affordance while the transport is halted, and end a drag it outran. */
  sync(): void;
}

/** The pointer's px from bar 1's line: the ruler's left edge, measured at every move so a scroll is followed. */
function rulerPx(lanes: HTMLElement, clientX: number): number {
  const ruler = lanes.querySelector('.ruler');
  return ruler ? clientX - ruler.getBoundingClientRect().left : Number.NaN;
}

/**
 * Wire the playhead's handle (windsor#102): a press on the label while the
 * transport is halted captures the pointer, every move previews the line on
 * the snapped bar, and the release seeks there through `ctx.transport.seek`,
 * the engine's. A cancel, a lost capture, a window blur or the transport
 * starting mid-drag puts the line back on the transport's position. The
 * `.seekable` class, set per frame by `sync`, is what lets the label take a
 * press at all, so a playing line never shadows the ruler.
 */
export function wirePlayheadDrag(wire: PlayheadDragWire): PlayheadDragHandle {
  const { ctx, lanes, line } = wire;
  const handle = line.firstElementChild;
  if (!(handle instanceof HTMLElement)) throw new Error('the playhead line has no label');
  let drag: PlayheadDrag | null = null;
  const grabState = () => ({ enabled: ctx.host.enabled, running: ctx.transport.running });
  const settle = (): void => {
    line.classList.remove('dragging');
    const tick = ctx.transport.position();
    placePlayhead(line, tick, wire.songTicks());
    wire.onTick(tick);
  };
  const onBlur = (): void => step({ type: 'cancel' });
  const step = (event: PlayheadDragEvent): void => {
    const was = drag;
    const next = stepPlayheadDrag(drag, event, { pxPerBar: wire.pxPerBar(), bars: wire.bars() });
    drag = next.drag;
    if (next.preview !== null) placePlayhead(line, barTick(next.preview), wire.songTicks());
    if (!was || drag) return;
    window.removeEventListener('blur', onBlur);
    if (handle.hasPointerCapture(was.pointerId)) handle.releasePointerCapture(was.pointerId);
    if (next.drop !== null) ctx.transport.seek(barTick(next.drop));
    settle();
  };
  handle.addEventListener('pointerdown', (down) => {
    if (!pressStartsDrag(down.button, grabState())) return;
    down.preventDefault();
    if (drag) step({ type: 'cancel' });
    drag = { pointerId: down.pointerId, originX: down.clientX, bar: null };
    line.classList.add('dragging');
    try {
      handle.setPointerCapture(down.pointerId);
    } catch {
      // A pointer the browser does not track: the drag still runs on the handle's own events.
    }
    window.addEventListener('blur', onBlur);
  });
  handle.addEventListener('pointermove', (e) => {
    const { pointerId, buttons, clientX } = e;
    step({ type: 'move', pointerId, buttons, clientX, px: rulerPx(lanes, clientX) });
  });
  handle.addEventListener('pointerup', (e) => step({ type: 'up', pointerId: e.pointerId }));
  handle.addEventListener('pointercancel', () => step({ type: 'cancel' }));
  handle.addEventListener('lostpointercapture', () => step({ type: 'cancel' }));
  return {
    get dragging() {
      return drag !== null;
    },
    sync() {
      const grabbable = canDragPlayhead(grabState());
      if (drag && !grabbable) step({ type: 'cancel' });
      line.classList.toggle('seekable', grabbable);
    },
  };
}

export interface SongPlayheadWatch {
  ctx: AppCtx;
  /** The lanes grid; the loop ends when it leaves the document and idles while its tab is hidden. */
  lanes: HTMLElement;
  line: HTMLElement;
  songTicks(): number;
  /** Called with the audible tick whenever it moved — the harmony lane lights its block. */
  onTick(tick: number): void;
  /** The lanes' own repaint check, run every shown frame before the playhead. */
  repaintIf(): void;
  /** The line's drag (windsor#102): synced every shown frame, and the line left alone while it runs. */
  drag: PlayheadDragHandle;
}

/** The view's one loop: the ruler line, the playing chord block, and the lanes' repaint check. */
export function watchSongPlayhead(watch: SongPlayheadWatch): void {
  watchPlayhead({
    attached: () => watch.lanes.isConnected,
    shown: () => watch.lanes.closest('[hidden]') === null,
    playheadAt: () => watch.ctx.transport.position(),
    mark: (tick) => {
      if (!watch.drag.dragging) placePlayhead(watch.line, tick, watch.songTicks());
      watch.onTick(tick);
    },
    repaintIf: () => {
      watch.repaintIf();
      watch.drag.sync();
    },
  });
}
