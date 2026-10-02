/**
 * What every part of the Euclid card shares (windsor#356): the card's
 * handle on its part and region, the session's view of it (the shown page
 * and the lane view, decision 2 of the issue: the console's, never the
 * song's), and the one write the rows go through.
 *
 * A row edit is `changePattern` into the region's pattern, as every card
 * edit is, so none restarts the sequencer. Removing a lane removes its row,
 * which a merge cannot say, so that edit writes the region's pattern whole
 * (`withRows` over `patternCopy`), the same full-copy write `changePattern`
 * makes.
 */
import type { EuclideanSpec, RegionStep } from '@windsor/engine';
import { partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
import type { Figure } from './euclidModel';
import { type RowFields, removesRow, withRows } from './euclidLaneModel';
import type { KnobElement } from './knob';
import type { LaneView } from './euclidLaneView';
import { changePattern, patternCopy } from './partEdits';

export type EuclidPage = 'pattern' | 'density';

/** The session's view of one part's card. */
export interface EuclidView {
  readonly page: EuclidPage;
  readonly lanes: LaneView;
}

const DEFAULT_VIEW: EuclidView = { page: 'pattern', lanes: 'own' };

/** Per part, by slot: kept across re-renders for the session, never written to the song. */
const views = new Map<number, EuclidView>();

export const viewOf = (slot: number): EuclidView => views.get(slot) ?? DEFAULT_VIEW;

export function setView(slot: number, change: Partial<EuclidView>): EuclidView {
  const next = { ...viewOf(slot), ...change };
  views.set(slot, next);
  return next;
}

/** The card's handle: what its rows, rail, pages and loop read and write. */
export interface EuclidCard {
  readonly ctx: AppCtx;
  readonly slot: number;
  /** The region whose pattern the card edits (windsor#75); absent, the part's sequencer. */
  readonly region: number | undefined;
  /** This card's spec, or null when the part is gone or re-kinded. */
  spec(): EuclideanSpec | null;
  /** The figure the player holds for the region while it plays it, else the region's preview. */
  figure(): Figure;
  /** The region's step at the audible tick, read once per frame; null while the transport is halted. */
  at: RegionStep | null;
  /** Write row fields; true when it took. The card repaints from the document on its next frame. */
  write(fields: RowFields): boolean;
  /** Freeze `pattern` into the document (a capture), or let the modulator back in (null). */
  capture(pattern: Figure | null): void;
  /** The knobs a Steps or bound turn can move (the `k` bounds, Rotate): re-read after it commits. */
  readonly dependents: KnobElement[];
  /** Rebuild the rows from the document now: after a write that did not take, or a view change. */
  refresh(): void;
  /** True while a press is held on the rows: the rows are not rebuilt under it. */
  pressing: boolean;
}

/** Write row fields into the card's region: a merge, or a whole pattern when a row is removed. */
export function writeRows(
  ctx: AppCtx,
  slot: number,
  region: number | undefined,
  fields: RowFields,
): boolean {
  if (!removesRow(fields)) return changePattern(ctx, slot, region, fields);
  const part = partAt(ctx.model.doc, slot);
  // A part's own sequencer is merged, which cannot drop a key; the Song pane always names a region.
  if (!part || region === undefined || !part.regions[region]) return false;
  const pattern = withRows(patternCopy(part, region), fields);
  const regions = part.regions.map((r, i) => (i === region ? { ...r, pattern } : r));
  return ctx.change(partChange(slot, { regions })).ok;
}
