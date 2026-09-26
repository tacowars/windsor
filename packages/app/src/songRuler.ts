/**
 * The Song view's bar ruler and its one playhead line (#709 decision 1 and
 * 5): `transport.bars` bars at the table's px-per-bar with beat ticks, and a
 * line through every lane placed from the transport's audible tick by
 * `stepStrip.ts`'s one loop — `watchPlayhead`, the way every card lights
 * its cells. The line reads `ctx.transport.position()` whether or not the
 * transport runs, so a paused song shows where it will resume and ■ puts it
 * back on bar 1.
 */
import type { AppCtx } from './context';
import { el } from './dom';
import { watchPlayhead } from './stepStrip';
import { formatPosition } from './transportModel';
import { SONG_VIEW, beatTickPx, rulerLabels, tickToPx } from './songViewTables';

/** The name-column cell and the ruler for `bars` bars: one `.ruler-bar` per bar, labelled, with three beat ticks. */
export function rulerRow(bars: number): [HTMLElement, HTMLElement] {
  const name = el('div', 'lane-name ruler-name');
  name.appendChild(el('small', '', 'bar · beat'));
  const ruler = el('div', 'ruler');
  for (const label of rulerLabels(bars)) {
    const bar = el('div', 'ruler-bar');
    bar.style.width = `${SONG_VIEW.pxPerBar}px`;
    bar.appendChild(el('span', '', label));
    for (const px of beatTickPx()) {
      const tick = el('i');
      tick.style.left = `${px}px`;
      bar.appendChild(tick);
    }
    ruler.appendChild(bar);
  }
  return [name, ruler];
}

/** The playhead line, with its `bar.beat.sixteenth` label. */
export function playheadLine(): HTMLElement {
  const line = el('span', 'ph-line');
  line.appendChild(el('i', '', formatPosition(0, 0)));
  return line;
}

/** Put the line on `tick`: its px from the song start, past the name column. */
export function placePlayhead(line: HTMLElement, tick: number, songTicks: number): void {
  const songTick = songTicks > 0 ? ((tick % songTicks) + songTicks) % songTicks : 0;
  line.style.left = `${SONG_VIEW.laneNameWidthPx + SONG_VIEW.laneGapPx + tickToPx(songTick)}px`;
  const label = line.firstChild;
  if (label) label.textContent = formatPosition(tick, songTicks);
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
