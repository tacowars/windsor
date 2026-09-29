/**
 * The library actions (#563, epic #564 decisions 7–10) without the DOM: what
 * the selected part's patch is (a library entry, an Init, a document-only
 * patch), whether it has unsaved edits, and Init, Save, Copy to new and
 * Delete over the library model and the open document. The modal collects
 * the metadata; this writes the file and keeps the song in step.
 */
import type { Patch } from '@windsor/engine';
import {
  FALLBACK_PATCH_ID,
  clonePatch,
  makePatch,
  partAt,
  patchLeafDifferences,
} from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
import { INIT_PATCH_NAME, initPresetId, isInitPreset } from './libraryConstants';
import type { LibraryModel } from './libraryModel';
import { isWritable, removeLibraryFile, writeLibraryFile } from './libraryModel';
import { assignPatchFields } from './partAutoName';
import { buildPatchFile, patchFileText } from './patchFileWriter';
import type { PatchMetadata } from './patchMetadata';
import { copyMetadata, slugify, uniqueId } from './patchMetadata';

export type PatchOrigin =
  | { kind: 'library'; id: string }
  | { kind: 'init' }
  | { kind: 'document'; id: string }
  | { kind: 'none' };

export interface PatchScope {
  ctx: AppCtx;
  library: LibraryModel;
  /** The selected part's slot (#597). */
  slot: number;
}

/** A fresh Init patch: `makePatch()` defaults under the Init name. */
export const initPatchDefaults = (): Patch => makePatch({ name: INIT_PATCH_NAME });

/** Where the selected part's patch came from. */
export function patchOrigin({ ctx, library, slot }: PatchScope): PatchOrigin {
  const preset = partAt(ctx.model.doc, slot)?.preset;
  if (preset === undefined) return { kind: 'none' };
  if (isInitPreset(preset)) return { kind: 'init' };
  if (Object.hasOwn(library.entries, preset)) return { kind: 'library', id: preset };
  return { kind: 'document', id: preset };
}

/** What the working patch is compared with for the modified marker. */
export function baselinePatch(scope: PatchScope, origin = patchOrigin(scope)): Patch | null {
  if (origin.kind === 'init') return initPatchDefaults();
  if (origin.kind === 'library') return scope.library.entries[origin.id]?.patch ?? null;
  return null;
}

/** True when the working patch differs from its library entry or Init defaults. */
export function isModified(scope: PatchScope, working: Patch): boolean {
  const baseline = baselinePatch(scope);
  return baseline !== null && patchLeafDifferences(working, baseline).length > 0;
}

export const canSave = (origin: PatchOrigin): boolean => origin.kind === 'library';
export const canCopy = (origin: PatchOrigin): boolean => origin.kind !== 'none';
export const canDelete = (origin: PatchOrigin, library: LibraryModel): boolean =>
  origin.kind === 'library' && isWritable(library, origin.id);

/**
 * True when Save on this part forks rather than overwrites: its patch is a
 * built-in, which stays read-only, so the edit goes to a new id in the
 * user's library (decision 1 of `2026-09-27-user-library-in-indexeddb`).
 */
export function saveForks(scope: PatchScope): boolean {
  const origin = patchOrigin(scope);
  return origin.kind === 'library' && !isWritable(scope.library, origin.id);
}

/** Why an id cannot be deleted, or null. */
export function deleteRefusal(id: string): string | null {
  return id === FALLBACK_PATCH_ID
    ? `"${id}" is the engine's fallback click (FALLBACK_PATCH_ID) and cannot be deleted.`
    : null;
}

/** The modal's pre-fill: the library entry's metadata, or Init's, or the document patch's name. */
export function currentMetadata(scope: PatchScope, working: Patch): PatchMetadata {
  const origin = patchOrigin(scope);
  if (origin.kind === 'library') {
    const entry = scope.library.entries[origin.id];
    if (entry) {
      return {
        name: working.name,
        category: entry.category,
        tags: [...entry.tags],
        description: entry.description,
      };
    }
  }
  return { name: working.name, category: '', tags: [], description: '' };
}

/** The Copy to new pre-fill: `<name> copy`, or `Init` from an Init patch. */
export function copyPrefill(scope: PatchScope, working: Patch): PatchMetadata {
  const current = currentMetadata(scope, working);
  return patchOrigin(scope).kind === 'init'
    ? { ...current, name: INIT_PATCH_NAME }
    : copyMetadata(current);
}

/** Load Init into the part: its own sentinel document patch, replaced whole each time. */
export function initPatch({ ctx, slot }: PatchScope): Patch {
  const patch = initPatchDefaults();
  const id = initPresetId(String(slot));
  ctx.change({ ...partChange(slot, { preset: id }), patches: { [id]: patch } });
  return patch;
}

/** The preset ids the document's parts play. */
const playedPresets = (ctx: AppCtx): Set<string> =>
  new Set(ctx.model.doc.parts.map((part) => part.preset));

/**
 * Drop every Init sentinel no part plays any more: an unsaved Init is
 * discarded, never exported. A live removal — `null` at each id (#629): this
 * runs right after a part's first patch pick, and as a restructure it was the
 * restart tacowars heard on every sequencer.
 */
export function dropInit(ctx: AppCtx): void {
  const patches = ctx.model.doc.patches;
  if (!patches) return;
  const played = playedPresets(ctx);
  const stale = Object.keys(patches).filter((id) => isInitPreset(id) && !played.has(id));
  if (stale.length === 0) return;
  ctx.change({ patches: Object.fromEntries(stale.map((id) => [id, null])) });
}

/**
 * A confirmed discard: the document copy (and so the live part) goes back to
 * the baseline — the library entry, or Init's defaults — so the edits are
 * really gone, not merely loaded over.
 */
export function discardEdits(scope: PatchScope): Patch | null {
  const origin = patchOrigin(scope);
  const baseline = baselinePatch(scope, origin);
  if (baseline === null || origin.kind === 'none' || origin.kind === 'document') return null;
  const id = origin.kind === 'init' ? initPresetId(String(scope.slot)) : origin.id;
  const restored = clonePatch(baseline);
  scope.ctx.change({ patches: { [id]: restored } });
  return restored;
}

export interface WriteRequest extends PatchScope {
  working: Patch;
  meta: PatchMetadata;
  download?: (id: string, text: string) => void;
}

/**
 * Save over the current library id; the open song's copy follows, since the
 * part plays it. A built-in forks instead: Copy to new under `meta`'s name.
 */
export async function savePatch(request: WriteRequest): Promise<string> {
  const origin = patchOrigin(request);
  if (origin.kind !== 'library') throw new Error('Save needs a library patch; use Copy to new.');
  if (saveForks(request)) return copyToNew(request);
  const { ctx, library, meta, working } = request;
  const file = buildPatchFile(meta, working);
  await writeLibraryFile(library, origin.id, patchFileText(file), request.download);
  if (ctx.model.doc.patches && Object.hasOwn(ctx.model.doc.patches, origin.id)) {
    ctx.change({ patches: { [origin.id]: file.patch } });
  }
  return origin.id;
}

/** Save the working patch as a new entry in the user's library (or the folder), and switch the part to it. */
export async function copyToNew(request: WriteRequest): Promise<string> {
  const { ctx, library, slot, meta, working } = request;
  const wasInit = patchOrigin(request).kind === 'init';
  const id = uniqueId(slugify(meta.name), [
    ...Object.keys(library.entries),
    ...Object.keys(ctx.model.doc.patches ?? {}),
  ]);
  const file = buildPatchFile(meta, working);
  await writeLibraryFile(library, id, patchFileText(file), request.download);
  const fields = assignPatchFields(ctx.model.doc, slot, id, file.patch.name);
  ctx.change({ ...partChange(slot, fields), patches: { [id]: file.patch } });
  if (wasInit) dropInit(ctx);
  return id;
}

/** Remove one of the user's patches (or a folder file); refused for a built-in and the fallback. Songs keep their copies. */
export async function deletePatch(library: LibraryModel, id: string): Promise<void> {
  const refusal = deleteRefusal(id);
  if (refusal) throw new Error(refusal);
  await removeLibraryFile(library, id);
}

/** The unsaved-changes question, or null when loading over the patch loses nothing. */
export function unsavedQuestion(scope: PatchScope, working: Patch): string | null {
  if (!isModified(scope, working)) return null;
  const origin = patchOrigin(scope);
  const what = origin.kind === 'init' ? 'the Init patch' : `"${working.name}"`;
  return `Discard the unsaved edits to ${what}? Save or Copy to new keeps them in the library.`;
}
