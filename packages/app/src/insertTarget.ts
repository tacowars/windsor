/**
 * The song-owned insert locations: a part's strip by slot, the master (#666)
 * and the two send buses (windsor#172). Cards share one document/live target.
 */
import type { DocumentPartial, InsertSpec, InsertStage, ReturnName } from '@windsor/engine';
import { RETURNS, isReturnName, partAt, musicPartName } from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
export type InsertTarget = number | 'master' | ReturnName;
/** Whether `target` is a send bus, Send A or Send B. */
export const isBusTarget = (target: InsertTarget): target is ReturnName => isReturnName(target);
/** A bus's chain as the document holds it, else the code's default chain. */
const busInserts = (ctx: AppCtx, bus: ReturnName): readonly InsertSpec[] =>
  ctx.model.doc.returns?.[bus]?.inserts ?? RETURNS[bus].inserts;
export const insertsOf = (ctx: AppCtx, target: InsertTarget): readonly InsertSpec[] =>
  target === 'master'
    ? (ctx.model.doc.master?.inserts ?? [])
    : isBusTarget(target)
      ? busInserts(ctx, target)
      : (partAt(ctx.model.doc, target)?.strip.inserts ?? []);
export const insertChange = (
  target: InsertTarget,
  inserts: readonly InsertSpec[],
): DocumentPartial =>
  target === 'master'
    ? { master: { inserts } }
    : isBusTarget(target)
      ? { returns: { [target]: { inserts } } }
      : partChange(target, { strip: { inserts } });
export const liveInsert = (
  ctx: AppCtx,
  target: InsertTarget,
  index: number,
): InsertStage<InsertSpec> | undefined =>
  target === 'master'
    ? ctx.host.system?.masterStrip?.inserts[index]
    : isBusTarget(target)
      ? ctx.host.system?.returnBus(target)?.inserts[index]
      : ctx.host.system?.strip(musicPartName(target))?.inserts[index];
