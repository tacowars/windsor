/**
 * The Song view's region edits (#709 decision 3; epic #703 decisions 2, 9,
 * 17), pure: what a click, an edge drag, a body drag, a split and a delete
 * do to one part's `regions`, and how a song-length change carries every
 * whole-song region along (decision 4's last line). Regions are integer
 * ticks, sorted and non-overlapping, inside the song — the shape the
 * normaliser keeps (`regionNormalise.ts`) — so every function returns a new
 * list in that shape for `ctx.change`, where arrays replace wholesale. The
 * snap grain is bars by default; the modifier snaps to the part's own step
 * (`divisor`) for grid / chord / euclidean and to the beat otherwise.
 * `regionModel.test.ts` pins the fixtures the ticket names.
 */
import type {
  ArrangementDocument,
  DocumentPartial,
  HarmonyEvent,
  Region,
  SequencerSpec,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  PPQ,
  TICKS_PER_BAR,
  isInfiniteRegion,
} from '../../../packages/client/src/audio/index-for-editor';
import { fitEvents } from './harmonyLaneModel';

/** The kinds whose modifier snap is their own step; the rest snap to the beat. */
const STEP_SNAPPED = new Set<SequencerSpec['kind']>(['grid', 'chord', 'euclidean']);

/** The snap grain in ticks: a bar, or with the modifier the part's step (its `divisor`) or a beat. */
export function snapGrain(spec: SequencerSpec | undefined, modifier: boolean): number {
  if (!modifier) return TICKS_PER_BAR;
  if (spec && STEP_SNAPPED.has(spec.kind) && 'divisor' in spec && spec.divisor > 0) {
    return spec.divisor;
  }
  return PPQ;
}

export const snapTick = (tick: number, grain: number): number => Math.round(tick / grain) * grain;
export const snapDown = (tick: number, grain: number): number => Math.floor(tick / grain) * grain;

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));
const endOf = (region: Region): number => region.start + region.duration;
const sorted = (regions: readonly Region[]): Region[] =>
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
 * A click on an empty stretch: one bar-snapped region from the bar under
 * `tick`, a bar long or as long as the gap allows; null when the tick is
 * inside a region, past the song, or the gap has no room.
 */
export function addRegion(
  regions: readonly Region[],
  tick: number,
  songTicks: number,
  grain: number = TICKS_PER_BAR,
): Region[] | null {
  const start = Math.max(0, snapDown(tick, grain));
  if (start >= songTicks || regionAt(regions, start) >= 0) return null;
  const next = regions.find((r) => r.start > start);
  const end = Math.min(start + TICKS_PER_BAR, next ? next.start : songTicks, songTicks);
  if (end <= start) return null;
  return sorted([...regions, { start, duration: end - start }]);
}

/** The region's end dragged to `tick`, snapped, kept at least a grain long and short of the next region and the song end. */
export function resizeRegionEnd(
  regions: readonly Region[],
  index: number,
  tick: number,
  songTicks: number,
  grain: number = TICKS_PER_BAR,
): Region[] {
  const region = regions[index];
  if (!region) return [...regions];
  const { hi } = bounds(regions, index, songTicks);
  const lo = region.start + grain;
  if (lo > hi) return [...regions];
  const end = clamp(snapTick(tick, grain), lo, hi);
  return regions.map((r, i) => (i === index ? { start: r.start, duration: end - r.start } : r));
}

/** The region's start dragged to `tick`, snapped, kept after the previous region and at least a grain before its end. */
export function resizeRegionStart(
  regions: readonly Region[],
  index: number,
  tick: number,
  grain: number = TICKS_PER_BAR,
): Region[] {
  const region = regions[index];
  if (!region) return [...regions];
  const { lo } = bounds(regions, index, Number.POSITIVE_INFINITY);
  const hi = endOf(region) - grain;
  if (lo > hi) return [...regions];
  const start = clamp(snapTick(tick, grain), lo, hi);
  return regions.map((r, i) => (i === index ? { start, duration: endOf(r) - start } : r));
}

/** The region moved so it starts at `tick`, snapped, keeping its duration and its neighbours. */
export function moveRegion(
  regions: readonly Region[],
  index: number,
  tick: number,
  songTicks: number,
  grain: number = TICKS_PER_BAR,
): Region[] {
  const region = regions[index];
  if (!region) return [...regions];
  const { lo, hi } = bounds(regions, index, songTicks);
  const last = hi - region.duration;
  if (lo > last) return [...regions];
  const start = clamp(snapTick(tick, grain), lo, last);
  return regions.map((r, i) => (i === index ? { start, duration: r.duration } : r));
}

/** The region cut in two at the snapped tick; unchanged when the cut lands on or outside its edges. */
export function splitRegion(
  regions: readonly Region[],
  index: number,
  tick: number,
  grain: number = TICKS_PER_BAR,
): Region[] {
  const region = regions[index];
  if (!region) return [...regions];
  const at = snapTick(tick, grain);
  if (at <= region.start || at >= endOf(region)) return [...regions];
  return regions.flatMap((r, i) =>
    i === index
      ? [
          { start: r.start, duration: at - r.start },
          { start: at, duration: endOf(r) - at },
        ]
      : [r],
  );
}

/** The region removed, leaving a gap: a rest. */
export function deleteRegion(regions: readonly Region[], index: number): Region[] {
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
export function fitRegions(
  regions: readonly Region[],
  songTicks: number,
  previousSongTicks: number,
): { regions: Region[]; changed: boolean } {
  if (isInfiniteRegion(regions, previousSongTicks)) {
    return {
      regions: [{ start: 0, duration: songTicks }],
      changed: songTicks !== previousSongTicks,
    };
  }
  const fitted = regions
    .filter((r) => r.start < songTicks)
    .map((r) => (endOf(r) > songTicks ? { start: r.start, duration: songTicks - r.start } : r));
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
 * A `transport.bars` edit carried through the song (decision 4): the
 * partial gains every part's fitted regions and the fitted harmony events
 * where they change, and `report` names them. Any other partial comes back
 * as it was. `AppContext.change` applies this to every partial, so the
 * strip's Bars knob needs no knowledge of regions.
 */
export function followSongLength(
  doc: ArrangementDocument,
  partial: DocumentPartial,
): { partial: DocumentPartial; report: string[] } {
  const bars = barsOf(partial);
  if (bars === null || bars === doc.transport.bars || bars < 1) return { partial, report: [] };
  const songTicks = bars * TICKS_PER_BAR;
  const previous = doc.transport.bars * TICKS_PER_BAR;
  const report: string[] = [];
  const parts: Record<number, { regions: Region[] }> = {};
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
