/** The two song-owned insert locations; cards share one document/live target (#666). */
import type { DocumentPartial, InsertSpec, InsertStage } from '@windsor/engine';
import { partAt, musicPartName } from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
export type InsertTarget = number | 'master';
export const insertsOf = (ctx: AppCtx, target: InsertTarget): readonly InsertSpec[] =>
  target === 'master'
    ? (ctx.model.doc.master?.inserts ?? [])
    : (partAt(ctx.model.doc, target)?.strip.inserts ?? []);
export const insertChange = (
  target: InsertTarget,
  inserts: readonly InsertSpec[],
): DocumentPartial =>
  target === 'master' ? { master: { inserts } } : partChange(target, { strip: { inserts } });
export const liveInsert = (
  ctx: AppCtx,
  target: InsertTarget,
  index: number,
): InsertStage<InsertSpec> | undefined =>
  target === 'master'
    ? ctx.host.system?.masterStrip?.inserts[index]
    : ctx.host.system?.strip(musicPartName(target))?.inserts[index];
