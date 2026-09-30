/**
 * The loop brace (windsor#30 decision 2, Ableton Live's loop brace): a thin
 * strip directly under the ruler's bar numbers holding the song's loop as a
 * grey bar with an inward-pointing triangle handle at each end, dimmed while
 * the loop is off, and — while it is on — a line at its start and its end
 * down through every lane.
 *
 * A drag in empty strip space draws a range, a handle moves that end, the
 * body the whole range; bars, or beats with Shift. The rules are
 * `loopBraceModel.ts`; this file wires them through `songLanes.ts`'s
 * `pointerDrag` — pointer capture, the threshold, and the end of a drag on a
 * cancel, a lost capture, a window blur or a move with the button up, the
 * ruler's guards (windsor#21). The strip is its own element, so the ruler's
 * zoom and double-click fit never see its presses (decision 4). A drag
 * previews on the strip and commits once on release, as one `ctx.change`;
 * it keeps the loop's on state, which is the loop button's.
 */
import { TICKS_PER_BAR } from '@windsor/engine';
import { el } from './dom';
import type { BraceGesture, LoopRange } from './loopBraceModel';
import {
  braceBox,
  braceGestureAt,
  dragBrace,
  loopChange,
  loopGrain,
  loopLineTicks,
} from './loopBraceModel';
import { pointerDrag } from './songLanes';
import type { SongView } from './songTab';
import { pxToTick, timelineLeftCss } from './songViewTables';

const STRIP_TITLE =
  'drag to draw a loop · drag a handle to move that end · drag the loop to move it · Shift snaps to beats';

/** The brace row's two grid cells, and the two lines the lanes grid holds over every lane. */
export interface LoopBraceRow {
  readonly row: [HTMLElement, HTMLElement];
  readonly lines: HTMLElement[];
}

/** Put the brace on `range` at the view's scale. */
function placeBrace(brace: HTMLElement, range: LoopRange, pxPerBar: number): void {
  const box = braceBox(range, pxPerBar);
  brace.style.left = `${box.leftPx}px`;
  brace.style.width = `${box.widthPx}px`;
}

/**
 * Put a line on `tick`, past the name and mixer columns. Its px follow the lanes'
 * `--bar`, as the playhead's do, so it sits on the bar line at every zoom.
 */
function placeLine(line: HTMLElement, tick: number): void {
  line.style.left = timelineLeftCss(tick / TICKS_PER_BAR);
}

/** Show the brace and its lines for `range`: the lines only while the loop is on. */
function showRange(
  parts: LoopBraceRow,
  range: LoopRange | undefined,
  on: boolean,
  px: number,
): void {
  const [, strip] = parts.row;
  const brace = strip.firstElementChild;
  if (brace instanceof HTMLElement) {
    brace.hidden = !range;
    if (range) placeBrace(brace, range, px);
  }
  const ticks = range ? loopLineTicks({ ...range, on }) : [];
  parts.lines.forEach((line, i) => {
    const tick = ticks[i];
    line.hidden = tick === undefined;
    if (tick !== undefined) placeLine(line, tick);
  });
}

/** The drag: a gesture from the press, a previewed range per move, one commit on release. */
function wireBrace(view: SongView, parts: LoopBraceRow): void {
  const [, strip] = parts.row;
  const loop = (): LoopRange | undefined => view.ctx.model.doc.transport.loop;
  const on = (): boolean => view.ctx.model.doc.transport.loop?.on === true;
  const pxAt = (e: PointerEvent): number => e.clientX - strip.getBoundingClientRect().left;
  let gesture: BraceGesture | null = null;
  let preview: LoopRange | null = null;
  pointerDrag(strip, {
    accept(down) {
      gesture = braceGestureAt(loop(), pxAt(down), view.state.pxPerBar);
      preview = null;
      return true;
    },
    move(e) {
      if (!gesture) return;
      const tick = pxToTick(pxAt(e), view.state.pxPerBar);
      preview = dragBrace(gesture, tick, {
        grain: loopGrain(e.shiftKey),
        songTicks: view.songTicks(),
      });
      showRange(parts, preview, on(), view.state.pxPerBar);
    },
    end(_e, moved) {
      const range = preview;
      gesture = null;
      preview = null;
      if (moved && range) view.commit(loopChange(range, on()));
    },
    abort() {
      gesture = null;
      preview = null;
      showRange(parts, loop(), on(), view.state.pxPerBar);
    },
  });
}

/** The name cell, the brace strip and the loop lines, drawn from the document at the view's scale. */
export function loopBraceRow(view: SongView): LoopBraceRow {
  const { loop } = view.ctx.model.doc.transport;
  const name = el('div', 'lane-name ruler-name loop-name');
  name.appendChild(el('small', '', 'loop'));
  const strip = el('div', 'loop-strip');
  strip.title = STRIP_TITLE;
  const brace = el('div', 'loop-brace');
  brace.classList.toggle('on', loop?.on === true);
  brace.appendChild(el('i', 'loop-handle start'));
  brace.appendChild(el('i', 'loop-handle end'));
  strip.appendChild(brace);
  const parts: LoopBraceRow = {
    row: [name, strip],
    lines: [el('span', 'loop-line'), el('span', 'loop-line')],
  };
  showRange(parts, loop, loop?.on === true, view.state.pxPerBar);
  wireBrace(view, parts);
  return parts;
}
