/**
 * The console's part edits as live partials. Structural (#629): a part added
 * on the lowest free slot, the selected part removed, a part's sequencer kind
 * changed — each one `ctx.change`, so the transport and every other part
 * keep playing where they are. The shape is the engine's: a whole part at a
 * free slot, `null` at a slot that leaves, `null` at a patch id that goes
 * with it (`removePartChange`). The normaliser fills the new part and the
 * kind's defaults through `DocumentModel.preview`, so nothing here restates
 * a default the engine owns. `ctx.restructure` is Import's and Restart's.
 *
 * And the pattern a card edits (windsor#75, epic windsor#70; record
 * `2026-09-29-each-region-plays-its-own-pattern`): a card reads the selected
 * region's pattern (`patternOf`) and writes a full copy of it back into that
 * region (`regionPatternChange`), never into `part.sequencer`; a drawn region
 * copies its neighbour (`drawRegionChange`); a kind change clears every
 * region's pattern.
 */
import type {
  ArrangementDocument,
  DocumentPartial,
  MusicPart,
  PartRegion,
  RegionPattern,
  SequencerKind,
  SequencerSpec,
} from '@windsor/engine';
import {
  TICKS_PER_BAR,
  partAt,
  regionPattern,
  removePartChange,
  songTicksOf,
  ticksPerBar,
} from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
import { deepMerge } from './documentModel';
import { addRegion, neighbourIndex, snapGrain, splitRegion } from './regionModel';
import { addPart, freshSequencer, setSequencerKind } from './songParts';

/** A raw document normalised without being adopted — `DocumentModel.preview`. */
export type Preview = (raw: unknown) => ArrangementDocument;

/** The partial adding a new Init part on the lowest free slot, whole and normalised; null when full. */
export function addPartChange(
  doc: ArrangementDocument,
  preview: Preview,
): { partial: DocumentPartial; slot: number } | null {
  const added = addPart(doc);
  if (!added) return null;
  const normalised = preview(added.doc);
  const part = partAt(normalised, added.slot);
  const patch = part && normalised.patches?.[part.preset];
  if (!part || !patch) return null;
  return {
    slot: added.slot,
    partial: { parts: { [added.slot]: part }, patches: { [part.preset]: patch } },
  };
}

/** The partial driving the part on `slot` with a `kind` sequencer at the kind's defaults, every region's pattern cleared; null when unchanged. */
export function sequencerKindChange(
  doc: ArrangementDocument,
  slot: number,
  kind: SequencerKind,
  preview: Preview,
): DocumentPartial | null {
  const next = setSequencerKind(doc, slot, kind);
  if (next === doc) return null;
  const part = partAt(preview(next), slot);
  if (!part) return null;
  // `setSequencerKind` cleared the regions' patterns (windsor#75 decision 6): send them when there were any.
  const patterned = partAt(doc, slot)?.regions.some((r) => r.pattern !== undefined) ?? false;
  const regions = patterned ? { regions: part.regions } : {};
  return partChange(slot, { sequencer: part.sequencer, ...regions });
}

/** Add a part live and select it; the slot it took, or null when the song is full or the engine refused. */
export function addPartLive(ctx: AppCtx): number | null {
  const change = addPartChange(ctx.model.doc, (raw) => ctx.model.preview(raw));
  if (!change || !ctx.change(change.partial).ok) return null;
  ctx.parts.pick(change.slot);
  ctx.render();
  ctx.notify(`added ${partAt(ctx.model.doc, change.slot)?.name ?? 'a part'} — pick its sequencer`);
  return change.slot;
}

/** Remove the part on `slot` live and select its nearest neighbour; false when nothing was removed. */
export function removePartLive(ctx: AppCtx, slot: number): boolean {
  const part = partAt(ctx.model.doc, slot);
  const partial = removePartChange(ctx.model.doc, slot);
  if (!part || !partial) return false;
  const index = ctx.model.doc.parts.findIndex((p) => p.slot === slot);
  if (!ctx.change(partial).ok) return false;
  const { parts } = ctx.model.doc;
  // The nearest remaining part: the one that took this index, else the last.
  const neighbour = parts[Math.min(index, parts.length - 1)];
  ctx.parts.pick(neighbour?.slot ?? 0);
  ctx.render();
  ctx.notify(`removed ${part.name}`);
  return true;
}

/** Change the part's sequencer kind live — only that part rebuilds (#597); false when unchanged or refused. */
export function setSequencerKindLive(ctx: AppCtx, slot: number, kind: SequencerKind): boolean {
  const partial = sequencerKindChange(ctx.model.doc, slot, kind, (raw) => ctx.model.preview(raw));
  if (!partial || !ctx.change(partial).ok) return false;
  ctx.render();
  return true;
}

/**
 * The kinds whose card edits the selected region's pattern (windsor#75; the
 * grid, lanes included, since windsor#76; the Figure since windsor#490).
 */
export const REGION_PATTERN_KINDS: ReadonlySet<SequencerKind> = new Set<SequencerKind>([
  'grid',
  'chord',
  'arp',
  'bass',
  'euclidean',
  'figure',
]);

/** True when `part`'s regions each carry their own pattern. */
export const keepsRegionPatterns = (part: Pick<MusicPart, 'sequencer'>): boolean =>
  REGION_PATTERN_KINDS.has(part.sequencer.kind);

/** A spec without its seed: what a region's pattern holds (the seed is the part's). */
function withoutSeed(spec: SequencerSpec): RegionPattern {
  const copy: Record<string, unknown> = { ...spec };
  delete copy.seed;
  // The kind's spec less its seed is exactly `RegionPattern`'s member for that kind.
  return copy as RegionPattern;
}

/** A full copy of what region `index` of `part` plays, less the seed: what a draw and a first edit write. */
export const patternCopy = (
  part: Pick<MusicPart, 'regions' | 'sequencer'>,
  index: number,
): RegionPattern => withoutSeed(regionPattern(part, index));

/**
 * What a split gives a region with no pattern of its own (decision 3): a copy
 * of the part's sequencer for a kind whose regions carry patterns, else none.
 */
export const splitFill = (part: Pick<MusicPart, 'sequencer'>): RegionPattern | undefined =>
  keepsRegionPatterns(part) ? withoutSeed(part.sequencer) : undefined;

/**
 * The snap grain of a gesture on region `index` of `part` — a split, an
 * alt-click split, an edge or body drag: the song's `bar`, or with the
 * modifier that region's own step (`regionPattern`'s divisor), never the
 * part's sequencer, which a card edit no longer touches.
 */
export const regionGrain = (
  part: Pick<MusicPart, 'regions' | 'sequencer'>,
  index: number,
  modifier: boolean,
  bar: number = TICKS_PER_BAR,
): number => snapGrain(regionPattern(part, index), modifier, bar);

/**
 * Region `index` of `part` cut at `tick`, snapped to that region's own grain
 * (`regionGrain`), both halves holding a copy of its pattern (decision 3);
 * null when there is no such region or the cut lands on one of its edges.
 */
export function splitPartRegion(
  part: Pick<MusicPart, 'regions' | 'sequencer'>,
  index: number,
  tick: number,
  modifier: boolean,
  bar: number = TICKS_PER_BAR,
): PartRegion[] | null {
  if (!part.regions[index]) return null;
  const grain = regionGrain(part, index, modifier, bar);
  const next = splitRegion(part.regions, index, tick, grain, splitFill(part));
  return next.length === part.regions.length ? null : next;
}

/**
 * The region a card on `part` edits (decision 2): the selected one, else the
 * first; null when the part has none.
 */
export function editedRegion(
  part: Pick<MusicPart, 'regions'>,
  selected: number | null,
): number | null {
  if (part.regions.length === 0) return null;
  return selected !== null && selected >= 0 && selected < part.regions.length ? selected : 0;
}

/**
 * What a card reads: region `region`'s pattern through the engine's
 * `regionPattern` (the part's seed included), or the part's sequencer when no
 * region is named.
 */
export function patternOf(
  doc: ArrangementDocument,
  slot: number,
  region?: number,
): SequencerSpec | undefined {
  const part = partAt(doc, slot);
  if (!part) return undefined;
  return region === undefined ? part.sequencer : regionPattern(part, region);
}

/**
 * The one write of a card's sequencer edit (decision 1): `fields` — a
 * sequencer partial as the cards send it, `{ steps }`, `{ register: {
 * octave } }` — merged into a full copy of what region `region` plays now
 * (its own pattern, or on the first edit the part's sequencer), objects
 * recursing and arrays replacing as the document's merge does, and written
 * whole into that region's `pattern`. Every other region is left as it is.
 * The `seed` is the part's, so a seed in `fields` goes to `part.sequencer`.
 * With no region named the edit goes to `part.sequencer`, as before region
 * patterns. Null when the part or the
 * region is gone.
 */
export function regionPatternChange(
  doc: ArrangementDocument,
  slot: number,
  region: number | undefined,
  fields: Readonly<Record<string, unknown>>,
): DocumentPartial | null {
  const part = partAt(doc, slot);
  if (!part) return null;
  if (region === undefined) return partChange(slot, { sequencer: fields });
  if (!part.regions[region]) return null;
  const { seed, ...rest } = fields;
  const change: Record<string, unknown> = seed === undefined ? {} : { sequencer: { seed } };
  if (Object.keys(rest).length > 0) {
    // Merged over a normalised pattern of the same kind; the document renormalises the result.
    const pattern = deepMerge(patternCopy(part, region), rest) as RegionPattern;
    change.regions = part.regions.map((r, i) => (i === region ? { ...r, pattern } : r));
  }
  return partChange(slot, change);
}

/** Write a card's sequencer edit live through `regionPatternChange`; false when nothing took. */
export function changePattern(
  ctx: AppCtx,
  slot: number,
  region: number | undefined,
  fields: Readonly<Record<string, unknown>>,
): boolean {
  const partial = regionPatternChange(ctx.model.doc, slot, region, fields);
  return partial !== null && ctx.change(partial).ok;
}

/** The kind's default pattern for the part on `slot`, as the normaliser fills it. */
function defaultPattern(
  doc: ArrangementDocument,
  slot: number,
  preview: Preview,
): RegionPattern | undefined {
  const parts = doc.parts.map((p) =>
    p.slot === slot ? { ...p, regions: [], sequencer: freshSequencer(p.sequencer.kind) } : p,
  );
  const sequencer = partAt(preview({ ...doc, parts }), slot)?.sequencer;
  return sequencer && withoutSeed(sequencer);
}

/**
 * A region drawn on the lane of the part on `slot` at `tick`, and its index
 * (decision 4), one bar of the song's meter long: it copies the pattern of the nearest region that starts
 * before it, else of the nearest after it, and the first region of a part
 * with none starts from the kind's default pattern. A kind whose regions
 * carry no pattern draws a bare region. Null when there is no room.
 */
export function drawRegionChange(
  doc: ArrangementDocument,
  slot: number,
  tick: number,
  preview: Preview,
): { regions: PartRegion[]; index: number } | null {
  const part = partAt(doc, slot);
  const bar = ticksPerBar(doc.transport.meter);
  const regions = part && addRegion(part.regions, tick, songTicksOf(doc), bar);
  if (!part || !regions) return null;
  const index = regions.findIndex((r) => !part.regions.includes(r));
  const added = regions[index];
  if (!added || !keepsRegionPatterns(part)) return { regions, index };
  const from = neighbourIndex(part.regions, added.start);
  const pattern = from >= 0 ? patternCopy(part, from) : defaultPattern(doc, slot, preview);
  if (!pattern) return { regions, index };
  return { regions: regions.map((r, i) => (i === index ? { ...r, pattern } : r)), index };
}
