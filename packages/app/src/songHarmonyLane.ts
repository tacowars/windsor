/**
 * The harmony lane (#709 decisions 1, 2 and 4): one block per event of the
 * timeline — the chord's name, its numeral and its size, wide as its
 * duration — a `+` tile past the last that appends a bar of the last degree,
 * and the block under the playhead lit. A click selects the block for the
 * harmony card in the pane; dragging a block's right edge resizes it, which
 * shifts every event after it (the pure `harmonyLaneModel.ts`). Chords
 * only: a rest is a gap in a part's regions (epic #703 decision 6).
 */
import type { ArrangementDocument } from '../../../packages/client/src/audio/index-for-editor';
import { chordAt, eventBounds } from '../../../packages/client/src/audio/index-for-editor';
import { el } from './dom';
import { appendEvent, eventLabel, setEventDuration } from './harmonyLaneModel';
import { pointerDrag } from './songLanes';
import type { SongView } from './songTab';
import { BLOCK_GAP_PX, REGION_EDGE_PX, pxToTick, tickToPx } from './songViewTables';

/** The `.hblk` for one drawn event block. */
function block(view: SongView, index: number, start: number, end: number): HTMLElement {
  const { doc } = view.ctx.model;
  const event = doc.harmony.events[index];
  const node = el('div', 'hblk');
  node.dataset['event'] = String(index);
  node.style.left = `${tickToPx(start)}px`;
  node.style.width = `${tickToPx(end - start) - BLOCK_GAP_PX}px`;
  if (event) {
    const label = eventLabel(doc.harmony, event);
    node.appendChild(el('b', '', label.name));
    node.appendChild(el('small', '', `${label.numeral} · ${label.sizeTag}`));
  }
  const selected = view.state.selection;
  node.classList.toggle('selected', selected?.kind === 'event' && selected.index === index);
  return node;
}

/** The right edge of a block drags the event's end: a preview while dragging, one commit on release. */
function wireEdgeDrag(view: SongView, node: HTMLElement, index: number, start: number): void {
  const laneLeft = (): number => (node.parentElement ?? node).getBoundingClientRect().left;
  const edgeTicks = pxToTick(REGION_EDGE_PX);
  pointerDrag(node, {
    accept: (e) => {
      const tick = pxToTick(e.clientX - laneLeft());
      return tick >= start + (node.offsetWidth > 0 ? pxToTick(node.offsetWidth) - edgeTicks : 0);
    },
    move: (e) => {
      const events = view.ctx.model.doc.harmony.events;
      const tick = pxToTick(e.clientX - laneLeft());
      const preview = setEventDuration(events, index, tick - start, view.songTicks());
      const next = preview[index];
      if (next) node.style.width = `${tickToPx(next.duration) - BLOCK_GAP_PX}px`;
    },
    end: (e, moved) => {
      if (!moved) return void view.select({ kind: 'event', index });
      const events = view.ctx.model.doc.harmony.events;
      const tick = pxToTick(e.clientX - laneLeft());
      view.commit(
        { harmony: { events: setEventDuration(events, index, tick - start, view.songTicks()) } },
        true,
      );
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
    wireEdgeDrag(view, node, bounds.index, bounds.start);
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
