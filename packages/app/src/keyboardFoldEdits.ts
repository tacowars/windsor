/**
 * The keyboard fold's edit (windsor#918, record `2026-10-18-keyboard-fold`
 * decisions 1 and 2): the partial setting one part's `fold`, which each of
 * the three Fold controls commits through `ctx.change` as one undo step.
 */
import type { ArrangementDocument, DocumentPartial } from '@windsor/engine';
import { partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
import type { PartFold } from './keyboardFold';

/** The partial giving the part on `slot` the fold `fold`; null when the part is gone or already has it. */
export function partFoldChange(
  doc: ArrangementDocument,
  slot: number,
  fold: PartFold,
): DocumentPartial | null {
  const part = partAt(doc, slot);
  return part && (part.fold ?? 'off') !== fold ? partChange(slot, { fold }) : null;
}

/** Fold the part on `slot` live, as one undo step. False when unchanged or refused. */
export function setPartFoldLive(ctx: AppCtx, slot: number, fold: PartFold): boolean {
  const partial = partFoldChange(ctx.model.doc, slot, fold);
  if (!partial || !ctx.change(partial).ok) return false;
  ctx.render();
  return true;
}
