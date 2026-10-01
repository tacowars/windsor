/**
 * The song-owned insert locations: a part's strip by slot, the master (#666),
 * the two send buses (windsor#172) and the song's group buses by key,
 * `group:3` (windsor#287), which no slot or bus name can collide with. Cards
 * share one document/live target.
 */
import type { DocumentPartial, InsertSpec, InsertStage, ReturnName } from '@windsor/engine';
import { RETURNS, isReturnName, partAt, musicPartName } from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
import { groupAt, groupIdOfKey } from './groupModel';
/** A group bus's chain, by the group's key (`groupModel.ts`'s `groupKey`). */
export type GroupTarget = `group:${number}`;
export type InsertTarget = number | 'master' | ReturnName | GroupTarget;
/** Whether `target` is a send bus, Send A or Send B. */
export const isBusTarget = (target: InsertTarget): target is ReturnName => isReturnName(target);
/** Whether `target` is a group bus. */
export const isGroupTarget = (target: InsertTarget): target is GroupTarget =>
  typeof target === 'string' && groupIdOfKey(target) !== null;
/** The id of the group a group target names. */
const groupIdOf = (target: GroupTarget): number => groupIdOfKey(target) ?? -1;
/** A bus's chain as the document holds it, else the code's default chain. */
const busInserts = (ctx: AppCtx, bus: ReturnName): readonly InsertSpec[] =>
  ctx.model.doc.returns?.[bus]?.inserts ?? RETURNS[bus].inserts;
export function insertsOf(ctx: AppCtx, target: InsertTarget): readonly InsertSpec[] {
  if (isGroupTarget(target)) return groupAt(ctx.model.doc, groupIdOf(target))?.inserts ?? [];
  return target === 'master'
    ? (ctx.model.doc.master?.inserts ?? [])
    : isBusTarget(target)
      ? busInserts(ctx, target)
      : (partAt(ctx.model.doc, target)?.strip.inserts ?? []);
}
export function insertChange(
  target: InsertTarget,
  inserts: readonly InsertSpec[],
): DocumentPartial {
  if (isGroupTarget(target)) return { groups: { [groupIdOf(target)]: { inserts } } };
  return target === 'master'
    ? { master: { inserts } }
    : isBusTarget(target)
      ? { returns: { [target]: { inserts } } }
      : partChange(target, { strip: { inserts } });
}
export function liveInsert(
  ctx: AppCtx,
  target: InsertTarget,
  index: number,
): InsertStage<InsertSpec> | undefined {
  const system = ctx.host.system;
  if (isGroupTarget(target)) return system?.groupBus(groupIdOf(target))?.inserts[index];
  return target === 'master'
    ? system?.masterStrip?.inserts[index]
    : isBusTarget(target)
      ? system?.returnBus(target)?.inserts[index]
      : system?.strip(musicPartName(target))?.inserts[index];
}
