/**
 * The console's structural edits as live partials (#629): a part added on
 * the lowest free slot, the selected part removed, a part's sequencer kind
 * changed — each one `ctx.change`, so the transport and every other part
 * keep playing where they are. The shape is the engine's: a whole part at a
 * free slot, `null` at a slot that leaves, `null` at a patch id that goes
 * with it (`removePartChange`). The normaliser fills the new part and the
 * kind's defaults through `DocumentModel.preview`, so nothing here restates
 * a default the engine owns. `ctx.restructure` is Import's and Restart's.
 */
import type { ArrangementDocument, DocumentPartial, SequencerKind } from '@windsor/engine';
import { partAt, removePartChange } from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
import { addPart, setSequencerKind } from './songParts';

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

/** The partial driving the part on `slot` with a `kind` sequencer at the kind's defaults; null when unchanged. */
export function sequencerKindChange(
  doc: ArrangementDocument,
  slot: number,
  kind: SequencerKind,
  preview: Preview,
): DocumentPartial | null {
  const next = setSequencerKind(doc, slot, kind);
  if (next === doc) return null;
  const part = partAt(preview(next), slot);
  return part ? partChange(slot, { sequencer: part.sequencer }) : null;
}

/** Add a part live and select it; the slot it took, or null when the song is full or the engine refused. */
export function addPartLive(ctx: AppCtx): number | null {
  const change = addPartChange(ctx.model.doc, (raw) => ctx.model.preview(raw));
  if (!change || !ctx.change(change.partial).ok) return null;
  ctx.parts.selected = change.slot;
  ctx.render();
  ctx.status(`added ${partAt(ctx.model.doc, change.slot)?.name ?? 'a part'} — pick its sequencer`);
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
  ctx.parts.selected = neighbour?.slot ?? 0;
  ctx.render();
  ctx.status(`removed ${part.name}`);
  return true;
}

/** Change the part's sequencer kind live — only that part rebuilds (#597); false when unchanged or refused. */
export function setSequencerKindLive(ctx: AppCtx, slot: number, kind: SequencerKind): boolean {
  const partial = sequencerKindChange(ctx.model.doc, slot, kind, (raw) => ctx.model.preview(raw));
  if (!partial || !ctx.change(partial).ok) return false;
  ctx.render();
  return true;
}
