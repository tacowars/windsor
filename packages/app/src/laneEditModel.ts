/**
 * What a pointer on a Song view lane is over, which cursor that shows, and
 * the readout a drag reads: the region-editing affordances the harmony track
 * (windsor#550) and the part lanes (windsor#551) share. Pure, after the
 * approved mockup's `hitPart` / `hitHarm` / `cursorFor` / `fmtPos` /
 * `fmtLen` (`docs/research/2026-10-03-song-region-editing/mockup.html`,
 * layout Proposed; record `2026-10-03-song-region-editing` decisions 4 and
 * 6). The DOM pieces they drive are `laneEditMarks.ts`; the tunables are
 * `laneEditTables.ts`.
 *
 * A seam is where two blocks of different items meet and is tested first,
 * ±`seamHitPx` around it but never more than a third of either neighbour
 * (the mockup's `seamOf`, so a short block keeps a body to click), the
 * nearest seam winning; then each block's start and end zones, `min(edgeMaxPx, a third of the block)` wide, on a
 * lane whose blocks have edges; then the body. The harmony track's outer
 * edges are the song's own, so its blocks have no edge zones.
 */
import type { Meter } from '@windsor/engine';
import { meterBeats } from '@windsor/engine';
import { barsBeats, toTicks } from './harmonyLaneModel';
import type { LaneCursorTable, LaneEditTable } from './laneEditTables';
import { LANE_CURSORS, LANE_EDIT } from './laneEditTables';
import type { BlockBox } from './songViewTables';
import { formatPosition } from './transportModel';
import { POSITION_SIXTEENTH } from './transportTables';

/**
 * A drawn block and the index of the item it draws (a harmony event, a
 * part region). A lane may draw one item as two blocks — the harmony
 * track's last chord also holds from tick 0 when the first starts later —
 * so a block's place in `boxes` is not its item's index.
 */
export interface LaneBox extends BlockBox {
  readonly index: number;
}

/**
 * A boundary where item `index`'s block ends and item `right`'s begins, at
 * `px` from the song start, between blocks spanning `leftWidthPx` and
 * `rightWidthPx` of the song (their spans, not their widened drawn boxes).
 */
export interface LaneSeam {
  readonly index: number;
  readonly right: number;
  readonly px: number;
  readonly leftWidthPx: number;
  readonly rightWidthPx: number;
}

/** Where a lane's blocks draw, which of their boundaries are seams, and whether a block's ends drag on their own. */
export interface LaneGeometry {
  readonly boxes: readonly LaneBox[];
  readonly seams: readonly LaneSeam[];
  readonly edges: boolean;
}

export type LaneHit =
  | { readonly kind: 'seam'; readonly index: number }
  | { readonly kind: 'start' | 'end' | 'body'; readonly index: number }
  | { readonly kind: 'gap' };

/** The grab zone at each end of a block `widthPx` wide: `edgeMaxPx`, at most a third of the block. */
export const edgeZonePx = (widthPx: number, table: LaneEditTable = LANE_EDIT): number =>
  Math.min(table.edgeMaxPx, widthPx * table.edgeFraction);

/** How far either side of `seam` grabs it: `seamHitPx`, at most `seamFraction` of either neighbour. */
export const seamZonePx = (seam: LaneSeam, table: LaneEditTable = LANE_EDIT): number =>
  Math.min(
    table.seamHitPx,
    seam.leftWidthPx * table.seamFraction,
    seam.rightWidthPx * table.seamFraction,
  );

/** The seam nearest `px` among those whose zone reaches it; the first on a tie. */
function nearestSeam(
  seams: readonly LaneSeam[],
  px: number,
  table: LaneEditTable,
): LaneSeam | null {
  let best: LaneSeam | null = null;
  let bestDistance = Infinity;
  for (const seam of seams) {
    const distance = Math.abs(px - seam.px);
    if (distance <= seamZonePx(seam, table) && distance < bestDistance) {
      best = seam;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * What a pointer `px` from the song start is over: a seam, then a block's
 * edge zone, then its body; a gap when none. Where widened blocks overlap
 * (the narrowest zoom's `MIN_BLOCK_PX`), the later one is drawn on top and
 * wins, as `hitBlocks` does.
 */
export function laneHitAt(
  lane: LaneGeometry,
  px: number,
  table: LaneEditTable = LANE_EDIT,
): LaneHit {
  const seam = nearestSeam(lane.seams, px, table);
  if (seam) return { kind: 'seam', index: seam.index };
  for (let at = lane.boxes.length - 1; at >= 0; at--) {
    const box = lane.boxes[at];
    if (!box) continue;
    const offset = px - box.leftPx;
    if (offset < 0 || offset > box.widthPx) continue;
    const { index } = box;
    if (lane.edges) {
      const zone = edgeZonePx(box.widthPx, table);
      if (offset < zone) return { kind: 'start', index };
      if (offset > box.widthPx - zone) return { kind: 'end', index };
    }
    return { kind: 'body', index };
  }
  return { kind: 'gap' };
}

/**
 * Where a seam drag puts the boundary before it snaps: where the boundary
 * was, moved by the pointer's travel since the press — the grab offset kept,
 * as `dragRegion` moves a region — never the pointer itself, so a press a
 * few px off the seam does not jump it.
 */
export const draggedBoundary = (boundary: number, pressTick: number, pointerTick: number): number =>
  boundary + (pointerTick - pressTick);

/** Which lane a hit is on: a harmony chord's body selects, a part region's body moves. */
export type LaneKind = 'harmony' | 'part';

/** The cursor a hit shows (the mockup's `cursorFor`): resize over an edge, `col-resize` over a seam. */
export function laneCursor(
  lane: LaneKind,
  hit: LaneHit,
  dragging: boolean,
  cursors: LaneCursorTable = LANE_CURSORS,
): string {
  if (hit.kind === 'seam') return cursors.seam;
  if (hit.kind === 'start' || hit.kind === 'end') return cursors.edge;
  if (lane === 'harmony') return hit.kind === 'body' ? cursors.pick : '';
  if (hit.kind === 'body') return dragging ? cursors.grabbing : cursors.grab;
  return cursors.draw;
}

/** One seam mark to draw: lit under the pointer or the drag, faint beside the selected block. */
export interface SeamMark {
  readonly index: number;
  readonly faint: boolean;
}

/**
 * The seam marks a lane shows: the one `active` (hovered or dragged) lit,
 * and those either side of the `selected` item faint, so a touch screen
 * shows where to grab.
 */
export function seamMarks(
  seams: readonly Pick<LaneSeam, 'index' | 'right'>[],
  selected: number | null,
  active: number | null,
): SeamMark[] {
  const out: SeamMark[] = [];
  for (const { index, right } of seams) {
    if (index === active) out.push({ index, faint: false });
    else if (selected !== null && (index === selected || right === selected)) {
      out.push({ index, faint: true });
    }
  }
  return out;
}

/** A tick as the readout reads it: `bar.beat` in the song's meter, with the sixteenth only when off the beat. */
export function readoutPosition(tick: number, meter?: Meter): string {
  const full = formatPosition(tick, 0, meter);
  return full.endsWith('.1') ? full.slice(0, -'.1'.length) : full;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A length in bars, counted beats and sixteenths left over (the mockup's `fmtLen`): `2 bars 1 beat`, `3 beats`. */
export function lengthLabel(ticks: number, meter?: Meter): string {
  const beats = meterBeats(meter);
  const { bars, beats: counted } = barsBeats(ticks, beats);
  const steps = Math.round((ticks - toTicks(bars, counted, beats)) / POSITION_SIXTEENTH);
  const out: string[] = [];
  if (bars) out.push(plural(bars, 'bar', 'bars'));
  if (counted) out.push(plural(counted, 'beat', 'beats'));
  if (steps) out.push(plural(steps, 'step', 'steps'));
  return out.join(' ') || '0';
}

/** A seam drag's readout: where the boundary is, and the two lengths either side. */
export const seamReadout = (
  tick: number,
  leftTicks: number,
  rightTicks: number,
  meter?: Meter,
): string =>
  `${readoutPosition(tick, meter)} · ${lengthLabel(leftTicks, meter)} | ${lengthLabel(rightTicks, meter)}`;

/** A block drag's readout (windsor#551): its start and end, and its length. */
export const spanReadout = (start: number, end: number, meter?: Meter): string =>
  `${readoutPosition(start, meter)} → ${readoutPosition(end, meter)} · ${lengthLabel(end - start, meter)}`;
