/**
 * The Song view's region edits (#709 decision 3; epic #703 decisions 2, 9,
 * 17), pure: what a click, an edge drag, a body drag, a split and a delete
 * do to one part's `regions`, and how a song-length change carries every
 * whole-song region along (decision 4's last line). Regions are integer
 * ticks, sorted and non-overlapping, inside the song — the shape the
 * normaliser keeps (`regionNormalise.ts`) — so every function returns a new
 * list in that shape for `ctx.change`, where arrays replace wholesale. The
 * snap grain is bars by default — the song's bar, `ticksPerBar(meter)`
 * (windsor#430), which every bar-grain function here takes as `bar` and
 * which defaults to the 4/4 bar; the modifier snaps to the part's own step
 * (`divisor`) for grid / chord / euclidean and to the beat otherwise.
 * `regionModel.test.ts` pins the fixtures the ticket names.
 *
 * A region may carry its own `pattern` (windsor#75, epic windsor#70; record
 * `2026-09-29-each-region-plays-its-own-pattern`), so every edit is generic
 * over the region and keeps what it holds: a move or a resize keeps the
 * pattern, a split gives both halves a copy, a delete takes it along.
 */
import type {
  ArrangementDocument,
  DocumentPartial,
  HarmonyEvent,
  PartRegion,
  Region,
  RegionPattern,
  SequencerSpec,
} from '@windsor/engine';
import { PPQ, TICKS_PER_BAR, isInfiniteRegion, songTicks as songLength } from '@windsor/engine';
import { fitEvents } from './harmonyLaneModel';

/** The kinds whose modifier snap is their own step; the rest snap to the beat. */
const STEP_SNAPPED = new Set<SequencerSpec['kind']>(['grid', 'chord', 'euclidean']);

/** The snap grain in ticks: a `bar`, or with the modifier the part's step (its `divisor`) or a beat. */
export function snapGrain(
  spec: SequencerSpec | undefined,
  modifier: boolean,
  bar: number = TICKS_PER_BAR,
): number {
  if (!modifier) return bar;
  if (spec && STEP_SNAPPED.has(spec.kind) && 'divisor' in spec && spec.divisor > 0) {
    return spec.divisor;
  }
  return PPQ;
}

export const snapTick = (tick: number, grain: number): number => Math.round(tick / grain) * grain;
export const snapDown = (tick: number, grain: number): number => Math.floor(tick / grain) * grain;

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));
const endOf = (region: Region): number => region.start + region.duration;
const sorted = <R extends Region>(regions: readonly R[]): R[] =>
  [...regions].sort((a, b) => a.start - b.start);

/** The index of the region holding `tick`, or -1 in a gap. */
export function regionAt(regions: readonly Region[], tick: number): number {
  return regions.findIndex((r) => tick >= r.start && tick < endOf(r));
}

/** The room a region has: the previous region's end and the next region's start (or the song end). */
function bounds(
  regions: readonly Region[],
  index: number,
  songTicks: number,
): { lo: number; hi: number } {
  const prev = regions[index - 1];
  const next = regions[index + 1];
  return { lo: prev ? endOf(prev) : 0, hi: next ? next.start : songTicks };
}

/**
 * A click on an empty stretch: one region from the start of the `bar` under
 * `tick`, a bar long or as long as the gap allows; null when the tick is
 * inside a region, past the song, or the gap has no room.
 */
export function addRegion(
  regions: readonly PartRegion[],
  tick: number,
  songTicks: number,
  bar: number = TICKS_PER_BAR,
): PartRegion[] | null {
  const start = Math.max(0, snapDown(tick, bar));
  if (start >= songTicks || regionAt(regions, start) >= 0) return null;
  const next = regions.find((r) => r.start > start);
  const end = Math.min(start + bar, next ? next.start : songTicks, songTicks);
  if (end <= start) return null;
  return sorted<PartRegion>([...regions, { start, duration: end - start }]);
}

/**
 * The region a new one drawn at `start` copies (windsor#75 decision 4): the
 * nearest region that starts before it, else the nearest after it; -1 when
 * the lane has none. The lane is sorted, so the last one before is the nearest.
 */
export function neighbourIndex(regions: readonly Region[], start: number): number {
  let before = -1;
  let after = -1;
  regions.forEach((r, i) => {
    if (r.start < start) before = i;
    else if (r.start > start && after < 0) after = i;
  });
  return before >= 0 ? before : after;
}

/** The region's end dragged to `tick`, snapped, kept at least a grain long and short of the next region and the song end. */
export function resizeRegionEnd<R extends Region>(
  regions: readonly R[],
  index: number,
  tick: number,
  songTicks: number,
  grain: number = TICKS_PER_BAR,
): R[] {
  const region = regions[index];
  if (!region) return [...regions];
  const { hi } = bounds(regions, index, songTicks);
  const lo = region.start + grain;
  if (lo > hi) return [...regions];
  const end = clamp(snapTick(tick, grain), lo, hi);
  return regions.map((r, i) => (i === index ? { ...r, duration: end - r.start } : r));
}

/** The region's start dragged to `tick`, snapped, kept after the previous region and at least a grain before its end. */
export function resizeRegionStart<R extends Region>(
  regions: readonly R[],
  index: number,
  tick: number,
  grain: number = TICKS_PER_BAR,
): R[] {
  const region = regions[index];
  if (!region) return [...regions];
  const { lo } = bounds(regions, index, Number.POSITIVE_INFINITY);
  const hi = endOf(region) - grain;
  if (lo > hi) return [...regions];
  const start = clamp(snapTick(tick, grain), lo, hi);
  return regions.map((r, i) => (i === index ? { ...r, start, duration: endOf(r) - start } : r));
}

/** The region moved so it starts at `tick`, snapped, keeping its duration and its neighbours. */
export function moveRegion<R extends Region>(
  regions: readonly R[],
  index: number,
  tick: number,
  songTicks: number,
  grain: number = TICKS_PER_BAR,
): R[] {
  const region = regions[index];
  if (!region) return [...regions];
  const { lo, hi } = bounds(regions, index, songTicks);
  const last = hi - region.duration;
  if (lo > last) return [...regions];
  const start = clamp(snapTick(tick, grain), lo, last);
  return regions.map((r, i) => (i === index ? { ...r, start } : r));
}

export type RegionDrag = 'move' | 'resizeStart' | 'resizeEnd';

/**
 * A drag of region `index`'s body or one of its edges by `deltaTicks` from
 * where it was pressed (windsor#21): the edge or the start moves by the
 * pointer's travel from the region's own tick, never to the pointer's
 * absolute tick — so a block `MIN_BLOCK_PX` drew wider than its span
 * changes by what the pointer moved, not by the widened offset.
 */
export function dragRegion<R extends Region>(
  regions: readonly R[],
  drag: { readonly kind: RegionDrag; readonly index: number; readonly deltaTicks: number },
  songTicks: number,
  grain: number = TICKS_PER_BAR,
): R[] {
  const region = regions[drag.index];
  if (!region) return [...regions];
  switch (drag.kind) {
    case 'resizeStart':
      return resizeRegionStart(regions, drag.index, region.start + drag.deltaTicks, grain);
    case 'resizeEnd':
      return resizeRegionEnd(
        regions,
        drag.index,
        endOf(region) + drag.deltaTicks,
        songTicks,
        grain,
      );
    case 'move':
      return moveRegion(regions, drag.index, region.start + drag.deltaTicks, songTicks, grain);
  }
}

/**
 * The region cut in two at the snapped tick; unchanged when the cut lands on
 * or outside its edges. Both halves hold the region's pattern (windsor#75
 * decision 3): its own, or `fill` — the part's sequencer, for a region that
 * had none — so each half then edits on its own. Without either, neither
 * half carries one.
 */
export function splitRegion(
  regions: readonly PartRegion[],
  index: number,
  tick: number,
  grain: number = TICKS_PER_BAR,
  fill?: RegionPattern,
): PartRegion[] {
  const region = regions[index];
  if (!region) return [...regions];
  const at = snapTick(tick, grain);
  if (at <= region.start || at >= endOf(region)) return [...regions];
  const pattern = region.pattern ?? fill;
  const held = pattern ? { pattern } : {};
  return regions.flatMap((r, i) =>
    i === index
      ? [
          { start: r.start, duration: at - r.start, ...held },
          { start: at, duration: endOf(r) - at, ...held },
        ]
      : [r],
  );
}

/** The region removed with its pattern, leaving a gap: a rest. */
export function deleteRegion<R extends Region>(regions: readonly R[], index: number): R[] {
  return regions.filter((_, i) => i !== index);
}

export type RegionMark = '∞' | '⟲';

/** The glyph at a block's left edge: ∞ for the one whole-song region, ⟲ for every region the pattern restarts in. */
export const regionMark = (regions: readonly Region[], songTicks: number): RegionMark =>
  isInfiniteRegion(regions, songTicks) ? '∞' : '⟲';

/**
 * A part's regions after the song length changed from `previousSongTicks`
 * to `songTicks`: a whole-song region follows the new length (it is still
 * ∞), a region past the end is dropped, and an end past it is clamped —
 * what the normaliser would do to the tail, done here so the live partial
 * and the document agree, plus the growth the normaliser cannot know about.
 */
export function fitRegions<R extends Region>(
  regions: readonly R[],
  songTicks: number,
  previousSongTicks: number,
): { regions: R[]; changed: boolean } {
  const whole = regions[0];
  if (whole && isInfiniteRegion(regions, previousSongTicks)) {
    return {
      regions: [{ ...whole, start: 0, duration: songTicks }],
      changed: songTicks !== previousSongTicks,
    };
  }
  const fitted = regions
    .filter((r) => r.start < songTicks)
    .map((r) => (endOf(r) > songTicks ? { ...r, duration: songTicks - r.start } : r));
  const changed =
    fitted.length !== regions.length ||
    fitted.some((r, i) => r.start !== regions[i]?.start || r.duration !== regions[i]?.duration);
  return { regions: fitted, changed };
}

const barsOf = (partial: DocumentPartial): number | null => {
  const bars = partial.transport?.bars;
  return typeof bars === 'number' && Number.isFinite(bars) ? Math.trunc(bars) : null;
};

/**
 * A `transport.bars` or `transport.meter` edit carried through the song
 * (decision 4): the partial gains every part's fitted regions and the
 * fitted harmony events where they change, and `report` names them. Any
 * other partial comes back as it was. `AppContext.change` applies this to
 * every partial, so neither the strip's Bars knob nor its meter picker
 * needs any knowledge of regions. Both lengths are bars of the song's meter
 * (windsor#430): the one the partial sets, else the document's. A meter
 * change keeps every tick and cuts what falls past a shorter song exactly
 * as lowering Bars does (windsor#431).
 */
export function followSongLength(
  doc: ArrangementDocument,
  partial: DocumentPartial,
): { partial: DocumentPartial; report: string[] } {
  const bars = barsOf(partial) ?? doc.transport.bars;
  const meter = partial.transport?.meter ?? doc.transport.meter;
  if (bars < 1) return { partial, report: [] };
  const songTicks = songLength(bars, meter);
  const previous = songLength(doc.transport.bars, doc.transport.meter);
  if (songTicks === previous) return { partial, report: [] };
  const report: string[] = [];
  const parts: Record<number, { regions: PartRegion[] }> = {};
  for (const part of doc.parts) {
    const fitted = fitRegions(part.regions, songTicks, previous);
    if (!fitted.changed) continue;
    parts[part.slot] = { regions: fitted.regions };
    report.push(`${part.name} regions`);
  }
  const events = fitEvents(doc.harmony.events, songTicks);
  const harmony: { events?: HarmonyEvent[] } = {};
  if (events.changed) {
    harmony.events = events.events;
    report.push('harmony events');
  }
  const next = {
    ...partial,
    ...(Object.keys(parts).length > 0 ? { parts: { ...partial.parts, ...parts } } : {}),
    ...(events.changed ? { harmony: { ...partial.harmony, ...harmony } } : {}),
  } as DocumentPartial;
  return { partial: next, report };
}
