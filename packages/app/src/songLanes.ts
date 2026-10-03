/**
 * The part lanes (#709 decisions 1 and 3): one lane per part by slot, each
 * a row of region blocks — teal for the pitched kinds, amber for Euclidean,
 * the kind and its summary in small caps, ⟲ on a region the pattern
 * restarts in and ∞ on the one whole-song region, faint ticks at the
 * pattern's cycle — over the pure `regionModel.ts`: a click on an empty
 * stretch adds a bar-snapped region, an edge drags its end, the body moves
 * it, alt-click splits it, and Shift snaps to the part's own step (or the
 * beat). Pointer events with capture, the way `chordDrag.ts` does it, so a
 * drag works on touch; a drag previews on the lane and commits once on
 * release, as one `ctx.change`.
 *
 * Each region carries its own pattern (windsor#75): a block's summary and
 * cycle ticks are that region's (`regionPattern`), a move or a resize keeps
 * the pattern, a split gives both halves a copy, and a drawn region copies
 * its neighbour's (`partEdits.ts`'s `drawRegionChange`).
 *
 * The name cell's `▸` folds the part's automation lanes out beneath it
 * (windsor#348; `songAutomationLane.ts` draws them), and a folded part with
 * lanes shows their count.
 */
import type { DocumentPart, MusicPart, PartRegion, Region } from '@windsor/engine';
import { regionPattern } from '@windsor/engine';
import { el } from './dom';
import { drawRegionChange, regionGrain, splitPartRegion } from './partEdits';
import type { RegionDrag } from './regionModel';
import { dragRegion, regionMark } from './regionModel';
import { KIND_LABELS } from './sequencerConstants';
import { laneCountLabel } from './songAutomationModel';
import type { SongView } from './songTab';
import {
  CYCLE_TICKS,
  LANE_TONE,
  REGION_SUMMARY,
  partNames,
  SONG_DRAG_THRESHOLD_PX,
  blockBox,
  boxTick,
  forKind,
  hitBlocks,
  isNarrowBlock,
  primaryHeld,
  pxToTick,
  tickToPx,
} from './songViewTables';
import type { BlockBox } from './songViewTables';

export interface DragHandlers {
  /** False refuses the press (the pointer is not on the handle). */
  accept?(e: PointerEvent): boolean;
  /** Every move past the threshold. */
  move(e: PointerEvent): void;
  /** The release; `moved` says whether the press became a drag. */
  end(e: PointerEvent, moved: boolean): void;
  /** A drag that ended without a release (cancel, lost capture, blur, a move with the button up): drop its preview. */
  abort(moved: boolean): void;
}

/**
 * A press-and-drag with pointer capture: under the threshold it is a click,
 * past it a drag. Only the pressing pointer's release commits (`end`); a
 * cancel, a lost capture, a window blur or a move with the primary button
 * up — a release it never saw — aborts, so a later hover never drags.
 */
export function pointerDrag(node: HTMLElement, handlers: DragHandlers): void {
  let live: { pointerId: number; x: number; moved: boolean } | null = null;
  const finish = (release: PointerEvent | null): void => {
    if (!live) return;
    const { pointerId, moved } = live;
    live = null;
    window.removeEventListener('blur', onBlur);
    if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
    if (release) handlers.end(release, moved);
    else handlers.abort(moved);
  };
  const onBlur = (): void => finish(null);
  const mine = (e: PointerEvent): boolean => live !== null && e.pointerId === live.pointerId;
  node.addEventListener('pointerdown', (down) => {
    if (down.button !== 0 || (handlers.accept && !handlers.accept(down))) return;
    down.stopPropagation();
    finish(null);
    live = { pointerId: down.pointerId, x: down.clientX, moved: false };
    try {
      node.setPointerCapture(down.pointerId);
    } catch {
      // A pointer the browser does not track (a synthetic event, a capture-less input): the drag still runs on the node's own events.
    }
    window.addEventListener('blur', onBlur);
  });
  node.addEventListener('pointermove', (e) => {
    if (!live || !mine(e)) return;
    if (!primaryHeld(e.buttons)) return void finish(null);
    if (!live.moved && Math.abs(e.clientX - live.x) < SONG_DRAG_THRESHOLD_PX) return;
    live.moved = true;
    handlers.move(e);
  });
  node.addEventListener('pointerup', (e) => {
    if (mine(e)) finish(e);
  });
  for (const type of ['pointercancel', 'lostpointercapture'] as const) {
    node.addEventListener(type, (e) => {
      if (mine(e)) finish(null);
    });
  }
}

/** One `.reg` block for a region of `part`, labelled with that region's own pattern. */
function regionBlock(view: SongView, part: MusicPart, index: number, region: Region): HTMLElement {
  const tone = LANE_TONE[part.sequencer.kind];
  const pattern = regionPattern(part, index);
  const cycle = forKind(CYCLE_TICKS, pattern);
  const node = el('div', `reg${tone === 'perc' ? ' perc' : ''}${cycle ? ' cyc' : ''}`);
  const px = view.state.pxPerBar;
  const bar = view.ticksPerBar();
  const box = blockBox(region.start, region.duration, px, bar);
  node.style.left = `${box.leftPx}px`;
  node.style.width = `${box.widthPx}px`;
  node.classList.toggle('narrow', isNarrowBlock(box.widthPx));
  if (cycle) node.style.setProperty('--cyc', `${tickToPx(cycle, px, bar)}px`);
  const mark = regionMark(part.regions, view.songTicks());
  const glyph = el('span', 'gl', mark);
  glyph.title = mark === '∞' ? 'whole song: free-running' : 'restarts on entry';
  node.appendChild(glyph);
  node.appendChild(
    el(
      'span',
      'lb',
      forKind(
        REGION_SUMMARY,
        pattern,
        view.ctx.model.doc.transport.meter,
        partNames(view.ctx.model.doc),
      ),
    ),
  );
  const selected = view.state.selection;
  node.classList.toggle(
    'selected',
    selected?.kind === 'part' && selected.slot === part.slot && selected.region === index,
  );
  return node;
}

/** A press in a gap adds; on a block it drags that block by the pointer's travel from `pressTick`. */
type Gesture = { kind: 'add' } | { kind: RegionDrag; index: number; pressTick: number };

const HIT_GESTURE = { start: 'resizeStart', end: 'resizeEnd', body: 'move' } as const;

/** The lane's scale: px per bar at the view's zoom, and the song's bar in ticks. */
interface LaneScale {
  readonly pxPerBar: number;
  readonly bar: number;
}

const scaleOf = (view: SongView): LaneScale => ({
  pxPerBar: view.state.pxPerBar,
  bar: view.ticksPerBar(),
});

const boxesOf = (regions: readonly Region[], scale: LaneScale): BlockBox[] =>
  regions.map((r) => blockBox(r.start, r.duration, scale.pxPerBar, scale.bar));

/**
 * What a press `px` into the lane starts: a new region in a gap, or an edge
 * or body drag of the drawn block under it — classified on the drawn boxes
 * (`hitBlocks`), so a block widened to its minimum is hit where it shows.
 */
function gestureAt(regions: readonly Region[], px: number, scale: LaneScale): Gesture {
  const found = hitBlocks(boxesOf(regions, scale), px);
  if (!found || !regions[found.index]) return { kind: 'add' };
  const pressTick = pxToTick(px, scale.pxPerBar, scale.bar);
  return { kind: HIT_GESTURE[found.hit], index: found.index, pressTick };
}

/**
 * Alt-click: the region whose drawn box is under `px` (windsor#21 — never a
 * raw tick lookup, which misses the widened part of a `MIN_BLOCK_PX` block)
 * cut at the tick the press maps to inside its span, snapped to that
 * region's own grain (`splitPartRegion`), both halves holding a copy of its
 * pattern; null when there is no block there or the cut lands on an edge.
 */
function splitAt(
  part: MusicPart,
  px: number,
  scale: LaneScale,
  modifier: boolean,
): { regions: PartRegion[]; index: number } | null {
  const boxes = boxesOf(part.regions, scale);
  const found = hitBlocks(boxes, px);
  const region = found ? part.regions[found.index] : undefined;
  const box = found ? boxes[found.index] : undefined;
  if (!found || !region || !box) return null;
  const span = { startTick: region.start, durationTicks: region.duration };
  const tick = boxTick(box, px, span, scale.pxPerBar, scale.bar);
  const next = splitPartRegion(part, found.index, tick, modifier, scale.bar);
  return next ? { regions: next, index: found.index } : null;
}

/** Redraw the lane's blocks from `regions` — the drag preview and the paint after a commit share it. */
function paintRegions(
  view: SongView,
  lane: HTMLElement,
  part: MusicPart,
  regions: readonly PartRegion[],
): void {
  lane.replaceChildren(
    ...regions.map((region, index) => regionBlock(view, { ...part, regions }, index, region)),
  );
}

function wireLane(view: SongView, lane: HTMLElement, part: MusicPart): void {
  const pxAt = (e: PointerEvent): number => e.clientX - lane.getBoundingClientRect().left;
  const tickAt = (e: PointerEvent): number =>
    pxToTick(pxAt(e), view.state.pxPerBar, view.ticksPerBar());
  const current = (): MusicPart =>
    view.ctx.model.doc.parts.find((p) => p.slot === part.slot) ?? part;
  let gesture: Gesture = { kind: 'add' };
  let draft: PartRegion[] | null = null;
  lane.addEventListener('pointerdown', (down) => {
    if (down.button !== 0 || !down.altKey) return;
    const split = splitAt(current(), pxAt(down), scaleOf(view), down.shiftKey);
    if (!split) return;
    down.stopPropagation();
    if (view.commit({ parts: { [part.slot]: { regions: split.regions } } })) {
      view.select({ kind: 'part', slot: part.slot, region: split.index + 1 });
    }
  });
  pointerDrag(lane, {
    accept: (e) => {
      if (e.altKey) return false;
      gesture = gestureAt(current().regions, pxAt(e), scaleOf(view));
      draft = null;
      return true;
    },
    move: (e) => {
      if (gesture.kind === 'add') return;
      const live = current();
      const grain = regionGrain(live, gesture.index, e.shiftKey, view.ticksPerBar());
      const deltaTicks = tickAt(e) - gesture.pressTick;
      const drag = { kind: gesture.kind, index: gesture.index, deltaTicks };
      draft = dragRegion(live.regions, drag, view.songTicks(), grain);
      paintRegions(view, lane, live, draft);
    },
    abort: () => {
      if (!draft) return;
      draft = null;
      const live = current();
      paintRegions(view, lane, live, live.regions);
    },
    end: (e, moved) => {
      const { ctx } = view;
      if (gesture.kind === 'add') {
        if (moved) return;
        const drawn = drawRegionChange(ctx.model.doc, part.slot, tickAt(e), (raw) =>
          ctx.model.preview(raw),
        );
        if (!drawn) return void view.select({ kind: 'part', slot: part.slot, region: null });
        if (view.commit({ parts: { [part.slot]: { regions: drawn.regions } } })) {
          view.select({ kind: 'part', slot: part.slot, region: drawn.index });
        }
        return;
      }
      const { index } = gesture;
      if (moved && draft) view.commit({ parts: { [part.slot]: { regions: draft } } });
      view.select({ kind: 'part', slot: part.slot, region: index });
    },
  });
}

/**
 * The part's fold (windsor#348 decision 1): `▸` folded, `▾` with its
 * automation lanes shown beneath it. Which parts are open is view state,
 * kept for the session; the focus stays on the button across the repaint.
 */
function foldButton(view: SongView, part: DocumentPart): HTMLButtonElement {
  const open = view.state.openParts.has(part.slot);
  const button = el('button', 'tri', open ? '▾' : '▸') as HTMLButtonElement;
  button.type = 'button';
  button.dataset['focus'] = `fold:${part.slot}`;
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} automation for ${part.name}`);
  button.onclick = (e): void => {
    e.stopPropagation();
    const grid = button.closest('.lanes');
    if (open) view.state.openParts.delete(part.slot);
    else view.state.openParts.add(part.slot);
    view.paintLanes();
    grid?.querySelector<HTMLElement>(`[data-focus="fold:${part.slot}"]`)?.focus();
  };
  return button;
}

/** The name-column cell and the lane of regions for `part`. */
export function partLaneRow(view: SongView, part: DocumentPart): [HTMLElement, HTMLElement] {
  const selected = view.state.selection;
  const isSelected = selected?.kind === 'part' && selected.slot === part.slot;
  const name = el('div', `lane-name${isSelected ? ' selected' : ''}`);
  name.appendChild(foldButton(view, part));
  const nm = el('span', 'nm');
  nm.appendChild(el('b', '', part.name));
  nm.appendChild(el('small', '', KIND_LABELS[part.sequencer.kind].toLowerCase()));
  name.appendChild(nm);
  const lanes = part.automation?.length ?? 0;
  if (lanes > 0 && !view.state.openParts.has(part.slot)) {
    name.classList.add('has-badge');
    name.appendChild(el('span', 'auto-badge', laneCountLabel(lanes)));
  }
  name.onclick = (): void => view.select({ kind: 'part', slot: part.slot, region: null });
  const lane = el('div', `lane${isSelected ? ' selected' : ''}`);
  lane.title =
    'click an empty stretch to add a bar · drag an edge to resize, the body to move · ' +
    'shift snaps to the step · alt-click splits';
  paintRegions(view, lane, part, part.regions);
  wireLane(view, lane, part);
  return [name, lane];
}
