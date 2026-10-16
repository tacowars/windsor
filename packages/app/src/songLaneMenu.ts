/**
 * The Song tab lane's context menu (windsor#826; record
 * `2026-10-16-song-tab-context-menu`, decisions 1–4 and 7–9): a right-click
 * on a part lane, or a touch or pen long press on it (`longPress.ts`),
 * selects what a click there would (the region, or the part on a gap) and
 * opens the shared context menu (`contextMenu.ts`) with the spec
 * `songLaneMenuModel.ts` builds. The press that opened it ends the lane's
 * drag, so its release neither selects nor draws.
 *
 * The rows run today's commands: the region clipboard's (`regionClipboard.ts`,
 * as the region keys run them), Alt-click's split, a gap click's bar, each
 * one `view.commit` and so one undo step; Zoom to region (`view.zoomTo`,
 * view state, no undo step); the loop through `loopChange`; the pane's
 * Bounce (`bouncePart`); the part color picker at the menu's opening
 * point; and the Parts tab's Seq picker's `setSequencerKindLive`. Their
 * previews draw on the lane and the loop strip and never touch the
 * document. The menu is built for the document it opened on: any change to
 * it (a region key, an undo or redo, an edit from elsewhere) closes the menu,
 * and a row of a stale menu refuses to run (`whileFresh`). Any key but
 * Escape closes it too, so ⌘C, which changes only the clipboard, can't leave
 * a stale Paste open; Paste also refuses once the clipboard holds another clip.
 */
import type { MusicPart, PartRegion } from '@windsor/engine';
import { partAt } from '@windsor/engine';
import { bouncePart } from './bounceButton';
import { openContextMenu } from './contextMenu';
import { el } from './dom';
import type { LongPressHandle } from './longPress';
import { wireLongPress } from './longPress';
import type { LoopRange } from './loopBraceModel';
import { braceBox, loopChange } from './loopBraceModel';
import { openPartColourPicker } from './partColourPicker';
import { drawRegionChange, setPartColourLive, setSequencerKindLive } from './partEdits';
import { laneScaleOf } from './partLaneBlocks';
import { copyRegion, cutRegion, duplicateRegion } from './regionClipboard';
import { deleteRegion } from './regionModel';
import type { Placement } from './regionPlacement';
import type { LaneMenuCommands } from './songLaneMenuModel';
import { laneMenu, lanePressAt, whileFresh } from './songLaneMenuModel';
import type { SongView } from './songTab';
import { blockBox, tickToPx, timelineLeftCss } from './songViewTables';

/** The press that opens the menu: where, and which pointer. */
interface MenuPress {
  readonly x: number;
  readonly y: number;
  readonly pointerType: string;
  /** A touch's or pen's pointer, still down, which the menu follows for slide-to-choose. */
  readonly pointerId?: number;
}

/** The previews on the lane and the loop strip: drawn nodes, all removed by `clear`. */
class LanePreview {
  private nodes: HTMLElement[] = [];

  constructor(
    private readonly view: SongView,
    private readonly grid: Element | null,
    private readonly slot: number,
  ) {}

  private lane(): HTMLElement | null {
    return this.grid?.querySelector<HTMLElement>(`.lane[data-part-slot="${this.slot}"]`) ?? null;
  }

  private add(parent: Element | null | undefined, node: HTMLElement): void {
    if (!parent) return;
    parent.appendChild(node);
    this.nodes.push(node);
  }

  region(span: { start: number; duration: number }): void {
    const { pxPerBar, bar } = laneScaleOf(this.view);
    const box = blockBox(span.start, span.duration, pxPerBar, bar);
    const node = el('div', 'lane-pv-reg');
    node.style.left = `${box.leftPx}px`;
    node.style.width = `${box.widthPx}px`;
    this.add(this.lane(), node);
  }

  cut(tick: number): void {
    const { pxPerBar, bar } = laneScaleOf(this.view);
    const node = el('div', 'lane-pv-cut');
    node.style.left = `${tickToPx(tick, pxPerBar, bar)}px`;
    this.add(this.lane(), node);
  }

  loop(range: LoopRange): void {
    const { pxPerBar, bar } = laneScaleOf(this.view);
    const box = braceBox(range, pxPerBar, bar);
    const brace = el('div', 'loop-brace on lane-pv-brace');
    brace.style.left = `${box.leftPx}px`;
    brace.style.width = `${box.widthPx}px`;
    brace.append(el('i', 'loop-handle start'), el('i', 'loop-handle end'));
    this.add(this.grid?.querySelector('.loop-strip'), brace);
    for (const tick of [range.start, range.end]) {
      const line = el('span', 'loop-line lane-pv-line');
      line.style.left = timelineLeftCss(tick / bar);
      this.add(this.grid, line);
    }
  }

  clear(): void {
    for (const node of this.nodes) node.remove();
    this.nodes = [];
  }
}

/** Commit `regions` to the part on `slot` and select `index` in them, as the region keys do. */
function write(
  view: SongView,
  slot: number,
  regions: readonly PartRegion[],
  index: number | null,
): void {
  if (view.commit({ parts: { [slot]: { regions: [...regions] } } })) {
    view.select({ kind: 'part', slot, region: index });
  }
}

/** Commit what a paste, a split, an add or a duplicate placed, and select it. */
const place = (view: SongView, slot: number, placed: Placement): void =>
  write(view, slot, placed.regions, placed.index);

/** The rows' work on the part on `slot`, read from the document at the run. */
function commands(
  view: SongView,
  slot: number,
  press: MenuPress,
  preview: LanePreview,
): LaneMenuCommands {
  const part = (): MusicPart | undefined => partAt(view.ctx.model.doc, slot);
  const bar = view.ticksPerBar();
  return {
    clipboard: () => view.state.clipboard,
    cut(index) {
      const now = part();
      const cut = now && cutRegion(now, index);
      if (!cut) return;
      write(view, slot, cut.regions, null);
      view.state.clipboard = cut.clip;
    },
    copy(index) {
      const now = part();
      const clip = now && copyRegion(now, index);
      if (clip) view.state.clipboard = clip;
    },
    duplicate(index) {
      const now = part();
      const placed = now && duplicateRegion(now, index, view.songTicks());
      if (placed) place(view, slot, placed);
    },
    delete(index) {
      const now = part();
      if (now) write(view, slot, deleteRegion(now.regions, index), null);
    },
    place: (placed) => place(view, slot, placed),
    zoom: (span) => view.zoomTo({ startBar: span.start / bar, bars: span.duration / bar }),
    loop: (range) => void view.commit(loopChange(range, true)),
    bounce: () => bouncePart(view, slot),
    colour() {
      // The document's part carries its colour, which the picker rings.
      const now = view.ctx.model.doc.parts.find((p) => p.slot === slot);
      if (!now) return;
      const at = { left: press.x, right: press.x, top: press.y, bottom: press.y };
      openPartColourPicker(at, now, (colour) => setPartColourLive(view.ctx, slot, colour));
    },
    setKind: (kind) => void setSequencerKindLive(view.ctx, slot, kind),
    showRegion: (span) => preview.region(span),
    showCut: (tick) => preview.cut(tick),
    showLoop: (range) => preview.loop(range),
    unpreview: () => preview.clear(),
  };
}

/** The latest opening waiting for its frames: a newer one replaces it. */
let waiting = 0;

/**
 * Run `open` once the selection's repaint has settled. The shared menu
 * closes on any scroll outside it, and the pane a selection repaints may
 * scroll itself as it lays out (a Roll card restores its view, dispatched
 * a frame later), so the menu opens two frames on, after those scrolls.
 */
function afterRepaint(open: () => void): void {
  const ticket = ++waiting;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (ticket === waiting) open();
    }),
  );
}

/** Open the menu for `press` on `lane`, the lane of the part on `slot`. */
function openLaneMenu(view: SongView, lane: HTMLElement, slot: number, press: MenuPress): void {
  const part = partAt(view.ctx.model.doc, slot);
  if (!part) return;
  const rect = lane.getBoundingClientRect();
  const grid = lane.closest('.lanes');
  const scale = laneScaleOf(view);
  const at = lanePressAt(part.regions, press.x - rect.left, scale);
  view.select({ kind: 'part', slot, region: at.region });
  const { doc } = view.ctx.model;
  const added =
    at.region === null
      ? drawRegionChange(doc, slot, at.tick, (raw) => view.ctx.model.preview(raw))
      : null;
  const facts = {
    part,
    region: at.region,
    tick: at.tick,
    bar: scale.bar,
    songTicks: view.songTicks(),
    clip: view.state.clipboard,
    added,
  };
  // The menu is for this document: a key edit, an undo or redo, or a change from elsewhere ends it.
  const fresh = (): boolean => view.ctx.model.doc === doc;
  const preview = new LanePreview(view, grid, slot);
  const spec = whileFresh(laneMenu(facts, commands(view, slot, press, preview)), fresh);
  afterRepaint(() => {
    if (!fresh()) return;
    // The menu is the pointer's: a key (⌘C, say) closes it and does its own work.
    const lane = { top: rect.top, bottom: rect.bottom };
    const close = openContextMenu(spec, { ...press, lane }, { closeOnKey: true });
    const off = view.ctx.model.onChange(() => {
      off();
      close();
    });
  });
}

/**
 * Wire the menu on `lane`, the lane of the part on `slot`: a right-click
 * (the browser's own menu suppressed) or a long press opens it, after
 * `endDrag` drops the lane's live press. The long press's handle goes back
 * to the lane's drag, which cancels a waiting press once it starts.
 */
export function wireLaneMenu(
  view: SongView,
  lane: HTMLElement,
  slot: number,
  endDrag: () => void,
): LongPressHandle {
  const open = (press: MenuPress): void => {
    endDrag();
    openLaneMenu(view, lane, slot, press);
  };
  const hold = wireLongPress(lane, (at) => open(at));
  lane.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // A touch platform's own long press may follow ours; one opening is enough.
    if (!hold.claimContextMenu()) return;
    const pointerType = e instanceof PointerEvent && e.pointerType !== '' ? e.pointerType : 'mouse';
    const finger =
      pointerType !== 'mouse' && e instanceof PointerEvent ? { pointerId: e.pointerId } : {};
    open({ x: e.clientX, y: e.clientY, pointerType, ...finger });
  });
  return hold;
}
