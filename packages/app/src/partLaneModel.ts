/**
 * The part lanes' region editing (windsor#551; record
 * `2026-10-03-song-region-editing` decisions 4 to 7), pure: where a lane's
 * blocks and seams sit for the shared hit test (`laneEditModel.ts`), what a
 * drag from a press makes of the part's regions, the readout it shows and
 * where, and which edge handles light. A seam is where one region's end is
 * the next one's start; dragging it rolls both (`rollRegionSeam`). An edge
 * or a body drags by the pointer's travel from the press (`dragRegion`), so
 * the grab offset holds. A press in a gap draws (`partEdits.ts`'s
 * `drawStrokeChange`). `partLaneGestures.ts` drives it.
 */
import type { Meter, MusicPart, PartRegion, Region } from '@windsor/engine';
import type { LaneGeometry, LaneHit, LaneSeam } from './laneEditModel';
import { draggedBoundary, seamReadout, spanReadout } from './laneEditModel';
import type { HandleLight } from './laneEditMarks';
import { regionGrain } from './partEdits';
import type { RegionDrag, SeamGrains } from './regionModel';
import { dragRegion, regionAt, rollRegionSeam } from './regionModel';
import { blockBox, tickToPx } from './songViewTables';

const endOf = (region: Region): number => region.start + region.duration;

/** A lane's scale: px per bar at the view's zoom, and the song's bar in ticks. */
export interface LaneScale {
  readonly pxPerBar: number;
  readonly bar: number;
}

/** A part lane's blocks, each keyed by its region, its seams where two regions touch, and edges on every block. */
export function partLaneGeometry(regions: readonly Region[], scale: LaneScale): LaneGeometry {
  const px = (tick: number): number => tickToPx(tick, scale.pxPerBar, scale.bar);
  const seams: LaneSeam[] = [];
  regions.forEach((left, index) => {
    const right = regions[index + 1];
    if (!right || endOf(left) !== right.start) return;
    seams.push({
      index,
      right: index + 1,
      px: px(right.start),
      leftWidthPx: px(left.duration),
      rightWidthPx: px(right.duration),
    });
  });
  const boxes = regions.map((r, index) => ({
    ...blockBox(r.start, r.duration, scale.pxPerBar, scale.bar),
    index,
  }));
  return { boxes, seams, edges: true };
}

/** A press on a part lane: what it hit, and the tick under it, from which a drag counts its travel. */
export interface LanePress {
  readonly hit: LaneHit;
  readonly tick: number;
}

/** A drag's readout: the tick it sits over, and what it says. */
export interface Readout {
  readonly tick: number;
  readonly text: string;
}

/** A drag's preview: the part's regions as they would commit, and the readout. */
export interface RegionDraft {
  readonly regions: PartRegion[];
  readonly readout: Readout;
}

/** How a drag snaps and reads: Shift's finer grain, the song's bar, its length and its meter. */
export interface DraftScale {
  readonly fine: boolean;
  readonly bar: number;
  readonly songTicks: number;
  readonly meter: Meter | undefined;
}

/** Where a readout sits over a block: on the edge a trim moves, or over the middle of a move or a draw. */
export type ReadoutAnchor = 'start' | 'end' | 'body';

/** A block's readout (decision 6): `start → end · length`, over `anchor`. */
export function spanAt(region: Region, anchor: ReadoutAnchor, meter?: Meter): Readout {
  const end = endOf(region);
  const middle = region.start + region.duration / 2;
  const tick = anchor === 'start' ? region.start : anchor === 'end' ? end : middle;
  return { tick, text: spanReadout(region.start, end, meter) };
}

/**
 * The grains the seam after region `index` rolls on: the finer of the two
 * regions' own (`regionGrain`, each region may carry its own step), at the
 * drag's modifier and at the step.
 */
export function seamGrains(
  part: Pick<MusicPart, 'regions' | 'sequencer'>,
  index: number,
  fine: boolean,
  bar: number,
): SeamGrains {
  const finer = (modifier: boolean): number =>
    Math.min(regionGrain(part, index, modifier, bar), regionGrain(part, index + 1, modifier, bar));
  return { grain: finer(fine), step: finer(true) };
}

const HIT_DRAG: Readonly<Record<ReadoutAnchor, RegionDrag>> = {
  start: 'resizeStart',
  end: 'resizeEnd',
  body: 'move',
};

/** A seam drag's draft: the boundary moved by the pointer's travel, rolled, and the two lengths read. */
function seamDraft(
  part: Pick<MusicPart, 'regions' | 'sequencer'>,
  index: number,
  travel: { from: number; to: number },
  scale: DraftScale,
): RegionDraft | null {
  const left = part.regions[index];
  if (!left) return null;
  const tick = draggedBoundary(endOf(left), travel.from, travel.to);
  const grains = seamGrains(part, index, scale.fine, scale.bar);
  const regions = rollRegionSeam(part.regions, index, tick, grains);
  const [l, r] = [regions[index], regions[index + 1]];
  if (!l || !r) return null;
  return {
    regions,
    readout: { tick: r.start, text: seamReadout(r.start, l.duration, r.duration, scale.meter) },
  };
}

/**
 * What a drag from `press` to `pointerTick` makes of `part`'s regions, and
 * its readout: a seam rolls its two regions, an edge trims its region and a
 * body moves it, each by the pointer's travel and snapped. Null for a press
 * in a gap (a draw) or on a region that is gone.
 */
export function regionDraft(
  part: Pick<MusicPart, 'regions' | 'sequencer'>,
  press: LanePress,
  pointerTick: number,
  scale: DraftScale,
): RegionDraft | null {
  const { hit } = press;
  if (hit.kind === 'gap') return null;
  if (hit.kind === 'seam') {
    return seamDraft(part, hit.index, { from: press.tick, to: pointerTick }, scale);
  }
  const grain = regionGrain(part, hit.index, scale.fine, scale.bar);
  const drag = { kind: HIT_DRAG[hit.kind], index: hit.index, deltaTicks: pointerTick - press.tick };
  const regions = dragRegion(part.regions, drag, scale.songTicks, grain);
  const region = regions[hit.index];
  return region ? { regions, readout: spanAt(region, hit.kind, scale.meter) } : null;
}

/** The region a press lands on: the block it hit, or on a seam the region holding its tick; -1 in a gap. */
export function pressedRegion(regions: readonly Region[], press: LanePress): number {
  const { hit } = press;
  if (hit.kind === 'gap') return -1;
  return hit.kind === 'seam' ? regionAt(regions, press.tick) : hit.index;
}

/**
 * The two handles of block `index`, start then end: lit on the edge under
 * the pointer or the drag (`active`), faint on the selected block so a
 * touch screen shows where to grab, else hidden.
 */
export function handleLights(
  index: number,
  active: LaneHit | null,
  selected: number | null,
): [HandleLight, HandleLight] {
  const light = (side: 'start' | 'end'): HandleLight => {
    if (active?.kind === side && active.index === index) return 'on';
    return index === selected ? 'faint' : '';
  };
  return [light('start'), light('end')];
}
