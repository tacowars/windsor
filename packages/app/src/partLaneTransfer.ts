/**
 * A part region's body drag beyond its own lane (record
 * `2026-10-07-song-region-drag-across-parts`): the lane under the
 * pointer's height is the target (`laneAtY` over the lanes' rects, since
 * the source lane holds the pointer's capture). Over the source lane it is
 * the same-lane move `partLaneGestures.ts` previews. Over another part of
 * the same sequencer kind the region drops there as copy and paste would
 * (`transferRegion`): the target lane previews the placed block with its
 * readout, and a move shows the source lane without it. Anywhere else the
 * drop is refused: the region shows back home, the cursor says
 * `not-allowed`, and a release toasts Paste's words. While the drag is
 * live every lane it can't drop on is dimmed and the lane under the
 * pointer bordered; a repaint of the lanes clears both.
 */
import type { MusicPart, SequencerKind } from '@windsor/engine';
import type { LaneSpan } from './laneSpans';
import { laneAtY } from './laneSpans';
import type { LaneMarks } from './partLaneBlocks';
import { paintLaneMarks, paintRegions } from './partLaneBlocks';
import { spanAt } from './partLaneModel';
import type { PasteRefusal } from './regionClipboard';
import { kindRefusal } from './regionClipboard';
import type { DropPointer, Transfer } from './regionTransfer';
import { regionDropAt, transferRegion } from './regionTransfer';
import type { SongView } from './songTab';

/** The rows of the timeline a body drag reads its target from: every lane, the ruler and the loop strip too. */
const ROWS = '.lane-timeline > *';
/** The rows a drag dims when it can't drop there: part, group and automation lanes. */
const LANES =
  '.lane-timeline > .lane, .lane-timeline > .auto-lane, .lane-timeline > .auto-add-lane';
const DIM = 'lane-drop-dim';
const TARGET = 'lane-drop-target';
const NO_MARKS: LaneMarks = { active: null, readout: null };

/** The pressed body: its lane and part, the region's index and the tick the press landed on. */
export interface TransferSource {
  readonly lane: HTMLElement;
  readonly part: MusicPart;
  readonly index: number;
  readonly pressTick: number;
}

/** Where a drag's pointer is: its tick on the timeline, Shift's finer grain, Cmd/Ctrl's copy. */
export type TransferPointer = DropPointer;

/** Where a body drag stands: over its own lane, dropping onto another part, or refused. */
export type TransferState = 'home' | 'onto' | 'refused';

export interface LaneTransfer {
  /** Read the target at `y` (client px), mark the lanes and, away from home, paint the preview. */
  move(y: number, pointer: TransferPointer): TransferState;
  /**
   * A release at `y` with the pointer as pointer-up has it: read the target
   * and the drop afresh, then commit it away from home, or toast the
   * refusal. False at home, for the same-lane release.
   */
  release(y: number, pointer: TransferPointer): boolean;
}

type Away =
  | {
      readonly kind: 'onto';
      readonly lane: HTMLElement;
      readonly part: MusicPart;
      readonly transfer: Transfer;
    }
  | { readonly kind: 'refused'; readonly refusal: PasteRefusal };

const slotOf = (row: Element): number | null => {
  const slot = (row as HTMLElement).dataset['partSlot'];
  return slot === undefined ? null : Number(slot);
};

/** Paint `lane` from `part`'s regions in the document, its marks cleared. */
function restore(view: SongView, lane: HTMLElement, part: MusicPart): void {
  paintRegions(view, lane, part, part.regions);
  paintLaneMarks(view, lane, part.slot, part.regions, NO_MARKS);
}

/** Dim every lane `kind` can't drop on, and border `target`. */
function markLanes(
  view: SongView,
  grid: Element,
  kind: SequencerKind,
  target: Element | null,
): void {
  const parts = view.ctx.model.doc.parts;
  for (const row of grid.querySelectorAll(LANES)) {
    const slot = slotOf(row);
    const fits = slot !== null && parts.find((p) => p.slot === slot)?.sequencer.kind === kind;
    row.classList.toggle(DIM, !fits);
    row.classList.toggle(TARGET, row === target);
  }
}

/** The row under `y`, read from the rows' rects now (they scroll and fold). */
function rowAt(grid: Element, y: number): Element | null {
  const spans: LaneSpan<Element>[] = [...grid.querySelectorAll(ROWS)].map((row) => {
    const rect = row.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, key: row };
  });
  return laneAtY(spans, y);
}

/** What the pointer over `row` makes of the drag from `source`: null over its own lane. */
function awayAt(
  view: SongView,
  source: TransferSource,
  row: Element | null,
  pointer: TransferPointer,
): Away | null {
  const slot = row ? slotOf(row) : null;
  if (row === source.lane || slot === source.part.slot) return null;
  const refused: Away = { kind: 'refused', refusal: kindRefusal(source.part.sequencer.kind) };
  const part = view.ctx.model.doc.parts.find((p) => p.slot === slot);
  const song = { songTicks: view.songTicks(), bar: view.ticksPerBar() };
  const drop = regionDropAt(source.part, source, pointer, song);
  if (!part || !drop || !(row instanceof HTMLElement)) return refused;
  const transfer = transferRegion(source.part, part, drop);
  if (!transfer) return refused;
  return 'refused' in transfer
    ? { kind: 'refused', refusal: transfer }
    : { kind: 'onto', lane: row, part, transfer };
}

/** Both lanes of a drop onto another part: the placed block with its readout (dashed for a copy), and the source as the drop leaves it. */
function paintOnto(
  view: SongView,
  source: TransferSource,
  onto: Extract<Away, { kind: 'onto' }>,
  copy: boolean,
): void {
  const { lane, part, transfer } = onto;
  const placed = transfer.target[transfer.index];
  paintRegions(view, lane, part, transfer.target, copy ? transfer.index : null);
  paintLaneMarks(view, lane, part.slot, transfer.target, {
    active: null,
    readout: placed ? spanAt(placed, 'body', view.ctx.model.doc.transport.meter) : null,
  });
  paintRegions(view, source.lane, source.part, transfer.source);
  paintLaneMarks(view, source.lane, source.part.slot, transfer.source, NO_MARKS);
}

/** A release away from home: both parts in one commit (one undo), the dropped region selected; or the refusal's toast. */
function releaseAway(view: SongView, source: TransferSource, away: Away): void {
  if (away.kind === 'refused') {
    view.paintLanes();
    return view.ctx.notify(away.refusal.refused, 'warning');
  }
  const { transfer, part } = away;
  const partial = {
    parts: {
      [source.part.slot]: { regions: transfer.source },
      [part.slot]: { regions: transfer.target },
    },
  };
  if (view.commit(partial)) {
    view.select({ kind: 'part', slot: part.slot, region: transfer.index });
  }
}

/** A body drag's reach beyond its lane, from `source`'s press. */
export function laneTransfer(view: SongView, source: TransferSource): LaneTransfer {
  const grid = source.lane.closest('.lanes');
  // The other part's lane a preview was painted on, put back when the pointer leaves it.
  let shown: { lane: HTMLElement; part: MusicPart } | null = null;
  const show = (next: { lane: HTMLElement; part: MusicPart } | null): void => {
    if (shown && shown.lane !== next?.lane) restore(view, shown.lane, shown.part);
    shown = next;
  };
  return {
    move(y, pointer) {
      if (!grid) return 'home';
      const row = rowAt(grid, y);
      const away = awayAt(view, source, row, pointer);
      markLanes(view, grid, source.part.sequencer.kind, away?.kind === 'refused' ? null : row);
      if (!away) {
        show(null);
        return 'home';
      }
      if (away.kind === 'refused') {
        show(null);
        restore(view, source.lane, source.part);
      } else {
        show({ lane: away.lane, part: away.part });
        paintOnto(view, source, away, pointer.copy);
      }
      return away.kind;
    },
    release(y, pointer) {
      const away = grid ? awayAt(view, source, rowAt(grid, y), pointer) : null;
      if (!away) return false;
      releaseAway(view, source, away);
      return true;
    },
  };
}
