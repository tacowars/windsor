/**
 * The harmony lane (#709 decisions 1, 2 and 4; windsor#550): one block per
 * event of the timeline — the chord's name, its numeral and its size, wide
 * as its duration — a `+` right of the lane that halves the selected chord
 * (or the rightmost), and the block under the playhead lit. A click selects
 * a block for the harmony card in the pane; the line between two chords is
 * a seam whose drag moves that boundary only, by the pointer's travel from
 * the press and snapped to the bar (a beat with Shift), and Alt-click splits
 * a chord at the snapped pointer, the last chord's wrapped hold included
 * (`harmonyLaneEdits.ts`, record `2026-10-03-song-region-editing`). The
 * hit test, cursor and readout are the lanes' shared `laneEditModel.ts`,
 * drawn by `laneEditMarks.ts`. A seam drag redraws both chords live and
 * commits once on release. Chords only: a rest is a gap in a part's regions
 * (epic #703 decision 6).
 */
import type { ArrangementDocument, EventBounds, HarmonyEvent } from '@windsor/engine';
import { chordAt, eventBounds } from '@windsor/engine';
import { el } from './dom';
import {
  chordGrid,
  halveEvent,
  halvingTarget,
  rollSeam,
  snapToGrid,
  splitEventAt,
} from './harmonyLaneEdits';
import { chordAtTick, harmonyGeometry, seamAfter } from './harmonyLaneGeometry';
import { eventLabel } from './harmonyLaneModel';
import { clearLaneMarks, readoutNode, seamMarkNode } from './laneEditMarks';
import type { LaneGeometry, LaneHit } from './laneEditModel';
import { draggedBoundary, laneCursor, laneHitAt, seamMarks, seamReadout } from './laneEditModel';
import { pointerDrag } from './songLanes';
import type { SongView } from './songTab';
import { blockBox, isNarrowBlock, pxToTick, tickToPx } from './songViewTables';

/** The drawn spans of `events`, each keyed by its event (the last's wrapped hold included). */
const spansOf = (view: SongView, events: readonly HarmonyEvent[]): EventBounds[] => [
  ...eventBounds({ ...view.ctx.model.doc.harmony, events: [...events] }, view.songTicks()),
];

const docEvents = (view: SongView): readonly HarmonyEvent[] => view.ctx.model.doc.harmony.events;

const selectedEvent = (view: SongView): number | null => {
  const selection = view.state.selection;
  return selection?.kind === 'event' ? selection.index : null;
};

/** The `.hblk` for one drawn event block of `events`. */
function block(view: SongView, events: readonly HarmonyEvent[], span: EventBounds): HTMLElement {
  const { doc } = view.ctx.model;
  const event = events[span.index];
  const node = el('div', 'hblk');
  node.dataset['event'] = String(span.index);
  const box = blockBox(span.start, span.end - span.start, view.state.pxPerBar, view.ticksPerBar());
  node.style.left = `${box.leftPx}px`;
  node.style.width = `${box.widthPx}px`;
  node.classList.toggle('narrow', isNarrowBlock(box.widthPx));
  if (event) {
    const label = eventLabel(doc.harmony, event);
    node.appendChild(el('b', '', label.name));
    node.appendChild(el('small', '', `${label.numeral} · ${label.sizeTag}`));
  }
  node.classList.toggle('selected', selectedEvent(view) === span.index);
  return node;
}

/** Redraw the lane's blocks from `events`, before the `+` tile, the playing block kept lit. */
function paintBlocks(view: SongView, lane: HTMLElement, events: readonly HarmonyEvent[]): void {
  const playing = lane.querySelector<HTMLElement>('.hblk.playing')?.dataset['event'];
  for (const node of lane.querySelectorAll(':scope > .hblk')) node.remove();
  const add = lane.querySelector(':scope > .hadd');
  for (const span of spansOf(view, events)) {
    const node = block(view, events, span);
    node.classList.toggle('playing', String(span.index) === playing);
    lane.insertBefore(node, add);
  }
}

/** Where the blocks of `events` draw, keyed by event, and where the chord changes (`harmonyLaneGeometry.ts`). */
const geometryOf = (view: SongView, events: readonly HarmonyEvent[]): LaneGeometry =>
  harmonyGeometry(spansOf(view, events), view.state.pxPerBar, view.ticksPerBar());

/** The seam marks over the lane — `active` lit, the selected chord's faint — and the readout, when dragging. */
function paintMarks(
  view: SongView,
  lane: HTMLElement,
  geometry: LaneGeometry,
  active: number | null,
  readout: { px: number; text: string } | null = null,
): void {
  clearLaneMarks(lane);
  for (const mark of seamMarks(geometry.seams, selectedEvent(view), active)) {
    const seam = geometry.seams.find((s) => s.index === mark.index);
    if (seam) lane.appendChild(seamMarkNode(seam.px, mark.faint));
  }
  if (readout) lane.appendChild(readoutNode(readout.px, readout.text));
}

/** The chord a press without a drag lands on: the block it hit, else the chord whose drawn span holds its tick. */
function chordUnder(view: SongView, hit: LaneHit, tick: number): number {
  if (hit.kind !== 'gap' && hit.kind !== 'seam') return hit.index;
  return chordAtTick(spansOf(view, docEvents(view)), tick);
}

/** A press that did not drag: Alt splits the chord at the snapped pointer (when both halves keep a beat); otherwise it selects. */
function pressChord(view: SongView, e: PointerEvent, hit: LaneHit, tick: number): void {
  const events = docEvents(view);
  const index = chordUnder(view, hit, tick);
  if (index < 0) return;
  if (e.altKey) {
    const split = splitEventAt(
      events,
      index,
      snapToGrid(tick, chordGrid(e.shiftKey, view.ticksPerBar())),
    );
    if (split) {
      if (view.commit({ harmony: { events: split.events } }, true)) {
        view.select({ kind: 'event', index: split.index });
      }
      return;
    }
  }
  view.select({ kind: 'event', index });
}

/** Where a pointer event falls on the lane, in px and in ticks from the song start. */
interface LanePointer {
  px(e: PointerEvent): number;
  tick(e: PointerEvent): number;
}

/** Hover: the cursor for what the pointer is over, and the seam under it lit; nothing while a press is live. */
function wireHover(
  view: SongView,
  lane: HTMLElement,
  at: LanePointer,
  pressed: () => boolean,
): void {
  let hovered: number | null = null;
  const light = (seam: number | null): void => {
    if (seam === hovered) return;
    hovered = seam;
    paintMarks(view, lane, geometryOf(view, docEvents(view)), seam);
  };
  lane.addEventListener('pointermove', (e) => {
    if (pressed()) return void (hovered = null);
    const hit = laneHitAt(geometryOf(view, docEvents(view)), at.px(e));
    lane.style.cursor = laneCursor('harmony', hit, false);
    light(hit.kind === 'seam' ? hit.index : null);
  });
  lane.addEventListener('pointerleave', () => {
    if (!pressed()) light(null);
  });
}

/** One move of a seam drag: the chords rolled to `tick` snapped, both blocks redrawn, the seam lit and the readout above it. */
function previewSeam(
  view: SongView,
  lane: HTMLElement,
  index: number,
  tick: number,
  fine: boolean,
): HarmonyEvent[] {
  const draft = rollSeam(
    docEvents(view),
    index,
    snapToGrid(tick, chordGrid(fine, view.ticksPerBar())),
  );
  paintBlocks(view, lane, draft);
  const pair = seamAfter(spansOf(view, draft), index);
  const readout = pair
    ? {
        px: tickToPx(pair[0].end, view.state.pxPerBar, view.ticksPerBar()),
        text: seamReadout(
          pair[0].end,
          pair[0].end - pair[0].start,
          pair[1].end - pair[1].start,
          view.ctx.model.doc.transport.meter,
        ),
      }
    : null;
  paintMarks(view, lane, geometryOf(view, draft), index, readout);
  return draft;
}

/** The tick of the seam a press hit, which its drag moves by the pointer's travel; 0 off a seam. */
function boundaryOf(view: SongView, hit: LaneHit): number {
  if (hit.kind !== 'seam') return 0;
  return seamAfter(spansOf(view, docEvents(view)), hit.index)?.[0].end ?? 0;
}

/** A seam drag's release: one commit when the boundary moved, else the lane back as it was. */
function releaseSeam(view: SongView, rolled: HarmonyEvent[] | null): void {
  const events = docEvents(view);
  const changed = rolled?.some((r, i) => r.start !== events[i]?.start) ?? false;
  if (!rolled || !changed || !view.commit({ harmony: { events: rolled } }, true)) view.paintLanes();
}

/**
 * The lane's pointer: the cursor and the lit seam on hover; a press on a
 * seam drags that boundary — both chords redrawn live, the readout above,
 * one commit on release — and any other press selects or Alt-splits on
 * release. A cancel puts the chords back.
 */
function wireLane(view: SongView, lane: HTMLElement): void {
  const root = document.documentElement;
  const at: LanePointer = {
    px: (e) => e.clientX - lane.getBoundingClientRect().left,
    tick: (e) => pxToTick(at.px(e), view.state.pxPerBar, view.ticksPerBar()),
  };
  let press: { hit: LaneHit; tick: number; boundary: number } | null = null;
  let draft: HarmonyEvent[] | null = null;
  const settle = (): void => {
    press = null;
    draft = null;
    root.style.cursor = '';
  };
  wireHover(view, lane, at, () => press !== null);
  pointerDrag(lane, {
    accept: (e) => {
      if (e.target instanceof Element && e.target.closest('.hadd')) return false;
      const hit = laneHitAt(geometryOf(view, docEvents(view)), at.px(e));
      press = { hit, tick: at.tick(e), boundary: boundaryOf(view, hit) };
      draft = null;
      return true;
    },
    move: (e) => {
      if (press?.hit.kind !== 'seam') return;
      root.style.cursor = laneCursor('harmony', press.hit, true);
      const tick = draggedBoundary(press.boundary, press.tick, at.tick(e));
      draft = previewSeam(view, lane, press.hit.index, tick, e.shiftKey);
    },
    end: (e, moved) => {
      const done = press;
      const rolled = draft;
      settle();
      if (!done) return;
      if (done.hit.kind === 'seam' && moved) return releaseSeam(view, rolled);
      if (!moved) return pressChord(view, e, done.hit, done.tick);
      if (done.hit.kind === 'body') view.select({ kind: 'event', index: done.hit.index });
    },
    abort: () => {
      const rolled = draft;
      settle();
      if (rolled) paintBlocks(view, lane, docEvents(view));
      paintMarks(view, lane, geometryOf(view, docEvents(view)), null);
    },
  });
}

/** The `+` tile: halves the selected chord, or the rightmost; disabled when that chord is under two beats. */
function addButton(view: SongView): HTMLButtonElement {
  const { doc } = view.ctx.model;
  const add = el('button', 'btn nudge hadd', '+') as HTMLButtonElement;
  add.type = 'button';
  add.title = 'Split the selected chord at its middle bar';
  add.setAttribute('aria-label', add.title);
  const split = (): ReturnType<typeof halveEvent> => {
    const events = doc.harmony.events;
    return halveEvent(events, halvingTarget(events, selectedEvent(view)), view.ticksPerBar());
  };
  add.disabled = split() === null;
  add.onclick = (): void => {
    const next = split();
    if (next && view.commit({ harmony: { events: next.events } }, true)) {
      view.select({ kind: 'event', index: next.index });
    }
  };
  return add;
}

/** HARMONY · chords for the frozen column, and the harmony lane, blocks and the `+` tile included. */
export function harmonyLaneRow(view: SongView): [HTMLElement, HTMLElement] {
  const name = el('div', 'lane-name');
  const nm = el('span', 'nm');
  nm.appendChild(el('b', '', 'Harmony'));
  nm.appendChild(el('small', '', 'chords'));
  name.appendChild(nm);
  const lane = el('div', 'lane lane-harm');
  const events = view.ctx.model.doc.harmony.events;
  lane.appendChild(addButton(view));
  paintBlocks(view, lane, events);
  paintMarks(view, lane, geometryOf(view, events), null);
  wireLane(view, lane);
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
