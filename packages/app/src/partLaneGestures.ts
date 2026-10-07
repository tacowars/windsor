/**
 * A part lane's pointer (#709 decision 3; windsor#551, record
 * `2026-10-03-song-region-editing`, the approved mockup's layout Proposed).
 * Hover shows what a press would grab: `ew-resize` and a lit handle on an
 * edge, `col-resize` and a lit seam mark where two regions touch, `grab` on
 * a body and `crosshair` on an empty stretch (`laneEditModel.ts`'s shared
 * hit test and cursors). A drag previews on the lane with its readout and
 * commits once on release, as one `ctx.change`: an edge trims its region
 * up to its neighbour, a seam rolls both regions, the body moves past its
 * neighbours over what it lands on (Cmd/Ctrl copies it), or onto another
 * part's lane of its kind (`partLaneTransfer.ts`; a body press counts
 * vertical travel toward the drag threshold too), and a drag
 * across an empty stretch draws a region that copies its neighbour's pattern
 * (`drawStrokeChange`). A click on a gap adds a bar, on a block or a seam
 * selects the region under the pointer, and Alt-click splits. Shift snaps
 * to the region's own step (or the beat). A cancel puts the regions back.
 */
import type { MusicPart, PartRegion } from '@windsor/engine';
import type { LaneHit } from './laneEditModel';
import { laneCursor, laneHitAt } from './laneEditModel';
import { LANE_CURSORS } from './laneEditTables';
import { drawRegionChange, drawStrokeChange, splitPartRegion } from './partEdits';
import type { LaneMarks } from './partLaneBlocks';
import { laneScaleOf, paintLaneMarks, paintRegions } from './partLaneBlocks';
import type { LanePress, LaneScale } from './partLaneModel';
import {
  draftChanges,
  partLaneGeometry,
  pressedRegion,
  regionDraft,
  spanAt,
} from './partLaneModel';
import { pointerDrag } from './pointerDrag';
import type { LaneTransfer } from './partLaneTransfer';
import { laneTransfer } from './partLaneTransfer';
import { dragModifiers } from './regionTransfer';
import { fitEmptyRolls } from './rollRegionFit';
import type { SongView } from './songTab';
import { boxTick, pxToTick } from './songViewTables';

/** Where a pointer event falls on the lane, in px and in ticks from the song start. */
interface LanePointer {
  px(e: PointerEvent): number;
  tick(e: PointerEvent): number;
}

const NO_MARKS: LaneMarks = { active: null, readout: null };

/** What a press `px` into `part`'s lane hits, and the tick under it. */
function pressAt(part: MusicPart, px: number, scale: LaneScale): LanePress {
  const hit = laneHitAt(partLaneGeometry(part.regions, scale), px);
  return { hit, tick: pxToTick(px, scale.pxPerBar, scale.bar) };
}

/**
 * Alt-click: the region under `px` — the block it hits, or on a seam the
 * region holding the tick (windsor#21: by the drawn box, never a raw tick
 * lookup, which misses the widened part of a `MIN_BLOCK_PX` block) — cut at
 * the tick the press maps to inside its span, snapped to that region's own
 * grain (`splitPartRegion`), both halves holding a copy of its pattern;
 * null when there is no region there or the cut lands on an edge.
 */
function splitAt(
  part: MusicPart,
  px: number,
  scale: LaneScale,
  modifier: boolean,
): { regions: PartRegion[]; index: number } | null {
  const index = pressedRegion(part.regions, pressAt(part, px, scale));
  const region = part.regions[index];
  const box = partLaneGeometry(part.regions, scale).boxes[index];
  if (!region || !box) return null;
  const span = { startTick: region.start, durationTicks: region.duration };
  const tick = boxTick(box, px, span, scale.pxPerBar, scale.bar);
  const next = splitPartRegion(part, index, tick, modifier, scale.bar);
  return next ? { regions: next, index } : null;
}

const sameHit = (a: LaneHit | null, b: LaneHit | null): boolean =>
  a?.kind === b?.kind && (a && 'index' in a ? a.index : -1) === (b && 'index' in b ? b.index : -1);

/** Hover: the cursor for what the pointer is over, and its handle or seam lit; nothing while a press is live. */
function wireHover(
  view: SongView,
  lane: HTMLElement,
  at: LanePointer,
  live: { part(): MusicPart | undefined; pressed(): boolean },
): void {
  let hovered: LaneHit | null = null;
  const light = (hit: LaneHit | null): void => {
    const part = live.part();
    if (!part || sameHit(hit, hovered)) return;
    hovered = hit;
    paintLaneMarks(view, lane, part.slot, part.regions, { active: hit, readout: null });
  };
  lane.addEventListener('pointermove', (e) => {
    const part = live.part();
    if (live.pressed() || !part) return void (hovered = null);
    const { hit } = pressAt(part, at.px(e), laneScaleOf(view));
    lane.style.cursor = laneCursor('part', hit, false);
    light(hit);
  });
  lane.addEventListener('pointerleave', () => {
    if (!live.pressed()) light(null);
  });
}

/**
 * One press's drag at one pointer event: its draft regions, the region it holds
 * in them (drawn, trimmed or moved; null for a seam roll), and whether a
 * move already fitted its empty rolls (`placeRegion`), since a move past a
 * neighbour reorders the list `fitEmptyRolls` pairs by index.
 */
interface Draft {
  readonly regions: PartRegion[];
  readonly index: number | null;
  readonly moved: boolean;
}

/** Where a drag's pointer is, in ticks; whether Shift asks for the finer grain, and Cmd/Ctrl for a copy. */
interface DragPointer {
  readonly tick: number;
  readonly fine: boolean;
  readonly copy: boolean;
}

/** The draft the press makes at the pointer, painted on the lane with its marks; null when it makes none. */
function preview(
  view: SongView,
  lane: HTMLElement,
  part: MusicPart,
  press: LanePress,
  pointer: DragPointer,
): Draft | null {
  const { ctx } = view;
  const { doc } = ctx.model;
  const meter = doc.transport.meter;
  if (press.hit.kind === 'gap') {
    const stroke = { from: press.tick, to: pointer.tick, modifier: pointer.fine };
    const drawn = drawStrokeChange(doc, part.slot, stroke, (raw) => ctx.model.preview(raw));
    const region = drawn?.regions[drawn.index];
    if (!drawn || !region) return null;
    paintRegions(view, lane, part, drawn.regions, drawn.index);
    paintLaneMarks(view, lane, part.slot, drawn.regions, {
      active: null,
      readout: spanAt(region, 'body', meter),
    });
    return { regions: drawn.regions, index: drawn.index, moved: false };
  }
  const scale = { fine: pointer.fine, bar: view.ticksPerBar(), songTicks: view.songTicks(), meter };
  const draft = regionDraft(part, press, pointer.tick, scale, pointer.copy);
  if (!draft) return null;
  const moved = press.hit.kind === 'body';
  paintRegions(view, lane, part, draft.regions, moved && pointer.copy ? draft.index : null);
  paintLaneMarks(view, lane, part.slot, draft.regions, {
    active: moved ? null : press.hit,
    readout: draft.readout,
  });
  return { regions: draft.regions, index: draft.index, moved };
}

/** A press without a drag: a gap adds a bar there, a block or a seam selects the region under the pointer. */
function click(view: SongView, part: MusicPart, press: LanePress): void {
  const { slot } = part;
  if (press.hit.kind !== 'gap') {
    const index = pressedRegion(part.regions, press);
    return view.select({ kind: 'part', slot, region: index >= 0 ? index : null });
  }
  const { ctx } = view;
  const drawn = drawRegionChange(ctx.model.doc, slot, press.tick, (raw) => ctx.model.preview(raw));
  if (!drawn) return view.select({ kind: 'part', slot, region: null });
  if (view.commit({ parts: { [slot]: { regions: drawn.regions } } })) {
    view.select({ kind: 'part', slot, region: drawn.index });
  }
}

/** Select the region an edge or body press grabbed; a seam or a gap leaves the selection. */
function selectGrabbed(view: SongView, slot: number, hit: LaneHit): void {
  if (hit.kind === 'start' || hit.kind === 'end' || hit.kind === 'body') {
    view.select({ kind: 'part', slot, region: hit.index });
  }
}

/**
 * A drag's release, read from pointer-up itself (where the pointer is, and
 * Shift and Cmd/Ctrl as they are now, never the last move's draft): a body
 * away from its lane drops there (`laneTransfer`); else one commit when the
 * regions changed, or the lane back as it was; then the region the drag
 * holds selected — drawn, trimmed, moved or copied. A seam roll keeps the
 * selection.
 */
function release(
  view: SongView,
  lane: HTMLElement,
  press: Press,
  pointer: DragPointer & { y: number },
): void {
  if (press.transfer?.release(pointer.y, pointer)) return;
  const { part } = press;
  const { slot } = part;
  const draft = preview(view, lane, part, press.at, pointer);
  if (!draft || !draftChanges(draft.regions, part.regions)) {
    view.paintLanes();
    return selectGrabbed(view, slot, press.at.hit);
  }
  const regions = draft.moved ? draft.regions : fitEmptyRolls(draft.regions, part.regions);
  if (!view.commit({ parts: { [slot]: { regions } } })) return;
  if (draft.index !== null) view.select({ kind: 'part', slot, region: draft.index });
}

/** Alt-click on the lane: split the region under the pointer (`splitAt`) and select its right half. */
function wireSplit(
  view: SongView,
  lane: HTMLElement,
  at: LanePointer,
  current: () => MusicPart | undefined,
): void {
  lane.addEventListener('pointerdown', (down) => {
    const part = current();
    if (down.button !== 0 || !down.altKey || !part) return;
    const split = splitAt(part, at.px(down), laneScaleOf(view), down.shiftKey);
    if (!split) return;
    down.stopPropagation();
    if (view.commit({ parts: { [part.slot]: { regions: split.regions } } })) {
      view.select({ kind: 'part', slot: part.slot, region: split.index + 1 });
    }
  });
}

/** One live press on the lane: the part as pressed, what it hit, and for a body its reach onto other lanes. */
interface Press {
  readonly part: MusicPart;
  readonly at: LanePress;
  readonly transfer: LaneTransfer | null;
}

/** The cursor a drag shows: refused, copying, or the grab its hit drags with. */
function dragCursor(press: Press, copy: boolean, refused: boolean): string {
  if (refused) return LANE_CURSORS.refuse;
  return copy && press.at.hit.kind === 'body'
    ? LANE_CURSORS.copy
    : laneCursor('part', press.at.hit, true);
}

/**
 * A drag's move: a body over another lane previews there (`laneTransfer`),
 * else the draft on the lane itself; with no draft, the lane as pressed.
 * Nothing is kept: the release reads its own event.
 */
function dragMove(
  view: SongView,
  lane: HTMLElement,
  press: Press,
  pointer: DragPointer & { y: number },
): void {
  const state = press.transfer?.move(pointer.y, pointer) ?? 'home';
  const cursor = dragCursor(press, pointer.copy, state === 'refused');
  document.documentElement.style.cursor = cursor;
  lane.style.cursor = cursor;
  if (state !== 'home') return;
  if (!preview(view, lane, press.part, press.at, pointer)) {
    paintRegions(view, lane, press.part, press.part.regions);
    paintLaneMarks(view, lane, press.part.slot, press.part.regions, {
      active: press.at.hit,
      readout: null,
    });
  }
}

/** Wire `lane`, the lane of the part on `slot`: hover, the drags, the clicks and Alt-click's split. */
export function wirePartLane(view: SongView, lane: HTMLElement, slot: number): void {
  const at: LanePointer = {
    px: (e) => e.clientX - lane.getBoundingClientRect().left,
    tick: (e) => pxToTick(at.px(e), view.state.pxPerBar, view.ticksPerBar()),
  };
  // Each event's own pointer and keys: a move previews with them, a release commits with them.
  const pointerOf = (e: PointerEvent): DragPointer & { y: number } => ({
    tick: at.tick(e),
    y: e.clientY,
    ...dragModifiers(e),
  });
  const current = (): MusicPart | undefined =>
    view.ctx.model.doc.parts.find((p) => p.slot === slot);
  let press: Press | null = null;
  const settle = (): void => {
    press = null;
    document.documentElement.style.cursor = '';
  };
  wireSplit(view, lane, at, current);
  wireHover(view, lane, at, { part: current, pressed: () => press !== null });
  const handlers = {
    accept: (e: PointerEvent): boolean => {
      const part = current();
      if (e.altKey || !part) return false;
      const hit = pressAt(part, at.px(e), laneScaleOf(view));
      const transfer =
        hit.hit.kind === 'body'
          ? laneTransfer(view, { lane, part, index: hit.hit.index, pressTick: hit.tick })
          : null;
      press = { part, at: hit, transfer };
      return true;
    },
    move: (e: PointerEvent): void => {
      if (press) dragMove(view, lane, press, pointerOf(e));
    },
    end: (e: PointerEvent, moved: boolean): void => {
      const done = press;
      settle();
      if (!done) return;
      if (!moved) return click(view, done.part, done.at);
      release(view, lane, done, pointerOf(e));
    },
    abort: (moved: boolean): void => {
      const done = press;
      settle();
      if (!done) return;
      // A body drag may have reached other lanes: repaint them all, dims and borders gone.
      if (done.transfer && moved) return view.paintLanes();
      paintRegions(view, lane, done.part, done.part.regions);
      paintLaneMarks(view, lane, slot, done.part.regions, NO_MARKS);
    },
  };
  // A body press counts vertical travel too, so a drag straight down onto another part starts (decision 8).
  pointerDrag(lane, handlers, { bothAxes: () => press?.transfer != null });
}
