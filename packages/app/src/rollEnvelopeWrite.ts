/**
 * Reading and writing a roll's clip envelopes (windsor#707 decision 7): the
 * list the region's pattern holds, and a new list written through the roll
 * editor's path (`regionPatternChange` → `ctx.change`) as one undo step
 * named for the edit ("Add Cutoff envelope"). The notes and the loop are
 * left as the document has them: a merge replaces the `envelopes` array
 * and recurses past everything else.
 */
import type { ArrangementDocument, RollEnvelope } from '@windsor/engine';
import type { AppCtx } from './context';
import { withGesture } from './gestureHooks';
import { patternOf, regionPatternChange } from './partEdits';

/** The envelopes region `region` of `slot` plays (the part's own roll with no region named). */
export function envelopesOf(
  doc: ArrangementDocument,
  slot: number,
  region: number | undefined,
): readonly RollEnvelope[] {
  const pattern = patternOf(doc, slot, region);
  return pattern?.kind === 'roll' ? (pattern.envelopes ?? []) : [];
}

/** Write `envelopes` as the region's whole list, one undo step named `label`; false when refused. */
export function writeEnvelopes(
  ctx: AppCtx,
  place: { readonly slot: number; readonly region: number | undefined },
  envelopes: readonly RollEnvelope[],
  label: string,
): boolean {
  const partial = regionPatternChange(ctx.model.doc, place.slot, place.region, { envelopes });
  if (partial === null) return false;
  return withGesture(label, () => ctx.change(partial).ok);
}
