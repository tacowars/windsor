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
 * press released without moving changes nothing, so the ruler's click stays
 * free for loop selection (windsor#15). The zoom stops at the fit, the
 * scale at which the whole song fills the window (windsor#21), and a
 * double-click returns to it at bar 1; a resize or a Bars change refits.
 */
import { TICKS_PER_BAR } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { watchPlayhead } from './stepStrip';
import { formatPosition } from './transportModel';
import { SONG_DRAG_THRESHOLD_PX, beatTickPx, rulerLabelEvery, rulerLabels } from './songViewTables';
import type { SongZoom, ZoomBounds, ZoomDragStart } from './songZoomModel';
import { clampScroll, dragZoom, fittedScale, followFit, zoomToFit } from './songZoomModel';

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
 * Put the line on `tick`, past the name column. Its px follow the lanes'
 * `--bar`, so a zoom moves the line with the regions even while the
 * transport stands still and the loop has no new tick to mark.
 */
export function placePlayhead(line: HTMLElement, tick: number, songTicks: number): void {
  const songTick = songTicks > 0 ? ((tick % songTicks) + songTicks) % songTicks : 0;
  line.style.left = `calc(var(--names) + var(--gap) + var(--bar) * ${songTick / TICKS_PER_BAR})`;
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
 * resize of the scroll container refits. The drag holds the pointer on the
 * lanes, which retargets the clicks there too, so the double-click is
 * placed by where it lands, not by its target.
 */
export function wireRulerZoom(zoom: RulerZoom): RulerZoomHandle {
  const { lanes, scroll, state } = zoom;
  lanes.addEventListener('pointerdown', (down) => {
    const ruler = down.target instanceof Element ? down.target.closest('.ruler') : null;
    if (down.button !== 0 || !(ruler instanceof HTMLElement)) return;
    down.preventDefault();
    const start: ZoomDragStart = {
      pxPerBar: state.pxPerBar,
      scrollPx: scroll.scrollLeft,
      pointerPx: down.clientX - ruler.getBoundingClientRect().left,
    };
    const bounds = measureBounds(zoom, start.pxPerBar);
    const scale = fittedScale(bounds);
    let moved = false;
    try {
      lanes.setPointerCapture(down.pointerId);
    } catch {
      // A pointer the browser does not track: the drag still runs on the lanes' own events.
    }
    const onMove = (e: PointerEvent): void => {
      const dx = e.clientX - down.clientX;
      const dy = e.clientY - down.clientY;
      if (!moved && Math.max(Math.abs(dx), Math.abs(dy)) < SONG_DRAG_THRESHOLD_PX) return;
      moved = true;
      applyZoom(zoom, dragZoom(start, { dx, dy }, bounds, scale));
    };
    const onUp = (): void => {
      lanes.removeEventListener('pointermove', onMove);
      lanes.removeEventListener('pointerup', onUp);
      lanes.removeEventListener('pointercancel', onUp);
    };
    lanes.addEventListener('pointermove', onMove);
    lanes.addEventListener('pointerup', onUp);
    lanes.addEventListener('pointercancel', onUp);
  });
  lanes.addEventListener('dblclick', (e) => {
    if (!onRuler(lanes, e)) return;
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
}

/** The view's one loop: the ruler line, the playing chord block, and the lanes' repaint check. */
export function watchSongPlayhead(watch: SongPlayheadWatch): void {
  watchPlayhead({
    attached: () => watch.lanes.isConnected,
    shown: () => watch.lanes.closest('[hidden]') === null,
    playheadAt: () => watch.ctx.transport.position(),
    mark: (tick) => {
      placePlayhead(watch.line, tick, watch.songTicks());
      watch.onTick(tick);
    },
    repaintIf: watch.repaintIf,
  });
}
