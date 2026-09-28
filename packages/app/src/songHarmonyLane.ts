/**
 * The harmony lane (#709 decisions 1, 2 and 4): one block per event of the
 * timeline — the chord's name, its numeral and its size, wide as its
 * duration — a `+` tile past the last that appends a bar of the last degree,
 * and the block under the playhead lit. A click selects the block for the
 * harmony card in the pane; dragging a block's right edge resizes it, which
 * shifts every event after it (the pure `harmonyLaneModel.ts`). Chords
 * only: a rest is a gap in a part's regions (epic #703 decision 6).
 */
import type { ArrangementDocument, HarmonyEvent } from '@windsor/engine';
import { chordAt, eventBounds } from '@windsor/engine';
import { el } from './dom';
import { appendEvent, eventLabel, resizeEventBy } from './harmonyLaneModel';
import { pointerDrag } from './songLanes';
import type { SongView } from './songTab';
import { blockBox, blockHitAt, isNarrowBlock, pxToTick } from './songViewTables';

/** The `.hblk` for one drawn event block. */
function block(view: SongView, index: number, start: number, end: number): HTMLElement {
  const { doc } = view.ctx.model;
  const event = doc.harmony.events[index];
  const node = el('div', 'hblk');
  node.dataset['event'] = String(index);
  const box = blockBox(start, end - start, view.state.pxPerBar);
  node.style.left = `${box.leftPx}px`;
  node.style.width = `${box.widthPx}px`;
  node.classList.toggle('narrow', isNarrowBlock(box.widthPx));
  if (event) {
    const label = eventLabel(doc.harmony, event);
    node.appendChild(el('b', '', label.name));
    node.appendChild(el('small', '', `${label.numeral} · ${label.sizeTag}`));
  }
  const selected = view.state.selection;
  node.classList.toggle('selected', selected?.kind === 'event' && selected.index === index);
  return node;
}

/** One drawn event's index and tick span, as `eventBounds` yields it. */
interface EventSpan {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

/**
 * A press on a block selects it; its right edge drags the event's end — a
 * preview while dragging, one commit on release. The duration changes by
 * the pointer's travel from the press (windsor#21), so a block widened past
 * its span to `MIN_BLOCK_PX` does not jump by the widened offset.
 */
function wireEdgeDrag(view: SongView, node: HTMLElement, bounds: EventSpan): void {
  const { index, start, end } = bounds;
  const laneLeft = (): number => (node.parentElement ?? node).getBoundingClientRect().left;
  const px = view.state.pxPerBar;
  const pxAt = (e: PointerEvent): number => e.clientX - laneLeft();
  // A press anywhere on the block selects it on release; only a press on the right edge band resizes.
  let onEdge = false;
  let pressPx = 0;
  const resized = (e: PointerEvent): HarmonyEvent[] =>
    resizeEventBy(
      view.ctx.model.doc.harmony.events,
      index,
      pxToTick(pxAt(e) - pressPx, px),
      view.songTicks(),
    );
  pointerDrag(node, {
    accept: (e) => {
      pressPx = pxAt(e);
      onEdge = blockHitAt(blockBox(start, end - start, px), pressPx) === 'end';
      return true;
    },
    move: (e) => {
      if (!onEdge) return;
      const next = resized(e)[index];
      if (!next) return;
      const width = blockBox(start, next.duration, px).widthPx;
      node.style.width = `${width}px`;
      node.classList.toggle('narrow', isNarrowBlock(width));
    },
    end: (e, moved) => {
      if (!moved || !onEdge) return void view.select({ kind: 'event', index });
      view.commit({ harmony: { events: resized(e) } }, true);
    },
    abort: (moved) => {
      if (moved && onEdge) view.paintLanes();
    },
  });
}

/** The name-column cell and the harmony lane, blocks and the `+` tile included. */
export function harmonyLaneRow(view: SongView): [HTMLElement, HTMLElement] {
  const name = el('div', 'lane-name');
  const nm = el('span', 'nm');
  nm.appendChild(el('b', '', 'Harmony'));
  nm.appendChild(el('small', '', 'chords'));
  name.appendChild(nm);
  const lane = el('div', 'lane lane-harm');
  const { doc } = view.ctx.model;
  const songTicks = view.songTicks();
  for (const bounds of eventBounds(doc.harmony, songTicks)) {
    const node = block(view, bounds.index, bounds.start, bounds.end);
    wireEdgeDrag(view, node, bounds);
    lane.appendChild(node);
  }
  const add = el('button', 'btn nudge hadd', '+') as HTMLButtonElement;
  add.type = 'button';
  add.title = 'append a chord: a bar of the last degree, taken from the last event';
  add.onclick = (): void => {
    const events = appendEvent(doc.harmony.events, songTicks);
    if (events.length === doc.harmony.events.length) return;
    if (view.commit({ harmony: { events } }, true)) {
      view.select({ kind: 'event', index: events.length - 1 });
    }
  };
  lane.appendChild(add);
  return [name, lane];
}

/** Light the block whose event holds at the audible tick, and no other. */
export function markPlayingBlock(
  lanes: HTMLElement,
  doc: ArrangementDocument,
  songTicks: number,
  tick: number,
): void {
  const playing = chordAt(doc.harmony, songTicks, tick)?.index ?? -1;
  for (const node of lanes.querySelectorAll<HTMLElement>('.hblk')) {
    node.classList.toggle('playing', Number(node.dataset['event']) === playing);
  }
}
