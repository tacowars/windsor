/**
 * A pattern action run on the console (windsor#827): the card's button and
 * the Song tab's region menu both call `runPatternAction`, which reads what
 * the card reads (the chord under the card's region, the Euclid figure it
 * shows, the Roll's Snap) and writes `patternActionModel.ts`'s partial as
 * one undo step, named as the card's write names it, with the card's toast.
 */
import type { AppCtx } from './context';
import { regionChord } from './chordRegionChord';
import { regionFigure } from './euclidFigure';
import type { Figure } from './euclidModel';
import { withGesture } from './gestureHooks';
import type { ActionReads, PatternAction } from './patternActionModel';
import { patternEdit } from './patternActionModel';
import { rollFrame } from './rollEditing';
import { readRollSource } from './rollSource';
import { rollViewOf } from './rollView';

/** The figure the Euclid card shows for region `region` of the part on `slot`: the player's while it plays, else the preview. */
export function figureOf(ctx: AppCtx, slot: number, region: number | undefined): Figure {
  const source = {
    doc: ctx.model.doc,
    capturePattern: (s: number, r?: number) => ctx.host.capturePattern(s, r),
    regionStepAt: (s: number, r: number, tick: number) => ctx.host.regionStepAt(s, r, tick),
    position: () => ctx.transport.position(),
  };
  return regionFigure(source, slot, region);
}

/** What an action reads on the console, each read when the action asks for it. */
export const consoleReads = (
  ctx: AppCtx,
  slot: number,
  region: number | undefined,
): ActionReads => ({
  random: () => Math.random(),
  chord: () => regionChord(ctx, slot, region),
  figure: () => figureOf(ctx, slot, region),
  rollFrame: () => rollFrame(readRollSource(ctx.model.doc, slot, region), rollViewOf(slot)),
});

/** Run `action` on region `region` of the part on `slot`; true when it wrote. */
export function runPatternAction(
  ctx: AppCtx,
  slot: number,
  region: number | undefined,
  action: PatternAction,
): boolean {
  const at = { doc: ctx.model.doc, slot, region, reads: consoleReads(ctx, slot, region) };
  const edit = patternEdit(action, at);
  if (!edit) return false;
  const write = (): boolean => ctx.change(edit.partial).ok;
  const ok = edit.label === undefined ? write() : withGesture(edit.label, write);
  if (ok && edit.notice !== undefined) ctx.notify(edit.notice);
  return ok;
}
