/**
 * The library actions (#563, epic #564 decisions 7–10) without the DOM: what
 * the selected part's patch is (a library entry, an Init, a document-only
 * patch), whether it has unsaved edits, and Init, Save, Copy to new and
 * Delete over the library model and the open document. The modal collects
 * the metadata; this writes the file and keeps the song in step.
 */
import type { MusicPartId, Patch } from '../../../packages/client/src/audio/index-for-editor';
import {
  GAMEPLAY_PATCH_IDS,
  makePatch,
  patchLeafDifferences,
} from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { INIT_PATCH_NAME, INIT_PRESET_ID } from './libraryConstants';
import type { LibraryModel } from './libraryModel';
import { removeLibraryFile, writeLibraryFile } from './libraryModel';
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
  partId: MusicPartId;
}

/** A fresh Init patch: `makePatch()` defaults under the Init name. */
export const initPatchDefaults = (): Patch => makePatch({ name: INIT_PATCH_NAME });

/** Where the selected part's patch came from. */
export function patchOrigin({ ctx, library, partId }: PatchScope): PatchOrigin {
  const preset = ctx.model.doc[partId]?.preset;
  if (preset === undefined) return { kind: 'none' };
  if (preset === INIT_PRESET_ID) return { kind: 'init' };
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
  origin.kind === 'library' && library.folder !== null;

/** Why an id cannot be deleted, or null. */
export function deleteRefusal(id: string): string | null {
  const gameplay = Object.values(GAMEPLAY_PATCH_IDS) as string[];
  return gameplay.includes(id)
    ? `"${id}" is played by game code (GAMEPLAY_PATCH_IDS) and cannot be deleted.`
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

/** Load Init into the part: the sentinel document patch, replaced whole each time. */
export function initPatch({ ctx, partId }: PatchScope): Patch {
  const patch = initPatchDefaults();
  ctx.change({ [partId]: { preset: INIT_PRESET_ID }, patches: { [INIT_PRESET_ID]: patch } });
  return patch;
}

/** Drop the Init sentinel once no part plays it: an unsaved Init is discarded, never exported. */
export function dropInit(ctx: AppCtx): void {
  const patches = ctx.model.doc.patches;
  if (!patches || !Object.hasOwn(patches, INIT_PRESET_ID)) return;
  const stillPlayed = Object.values(ctx.model.doc).some(
    (slot) =>
      typeof slot === 'object' &&
      slot !== null &&
      'preset' in slot &&
      slot.preset === INIT_PRESET_ID,
  );
  if (stillPlayed) return;
  ctx.restructure((draft) => {
    const drafted = draft['patches'] as Record<string, unknown> | undefined;
    if (!drafted) return;
    delete drafted[INIT_PRESET_ID];
    if (Object.keys(drafted).length === 0) delete draft['patches'];
  });
}

export interface WriteRequest extends PatchScope {
  working: Patch;
  meta: PatchMetadata;
  download?: (id: string, text: string) => void;
}

/** Save over the current library id; the open song's copy follows, since the part plays it. */
export async function savePatch(request: WriteRequest): Promise<string> {
  const origin = patchOrigin(request);
  if (origin.kind !== 'library') throw new Error('Save needs a library patch; use Copy to new.');
  const { ctx, library, meta, working } = request;
  const file = buildPatchFile(meta, working, library.entries[origin.id]?.headroom);
  await writeLibraryFile(library, origin.id, patchFileText(file), request.download);
  if (ctx.model.doc.patches && Object.hasOwn(ctx.model.doc.patches, origin.id)) {
    ctx.change({ patches: { [origin.id]: file.patch } });
  }
  return origin.id;
}

/** Save the working patch as a new library entry, and switch the part to it. */
export async function copyToNew(request: WriteRequest): Promise<string> {
  const { ctx, library, partId, meta, working } = request;
  const wasInit = patchOrigin(request).kind === 'init';
  const id = uniqueId(slugify(meta.name), [
    ...Object.keys(library.entries),
    ...Object.keys(ctx.model.doc.patches ?? {}),
  ]);
  const file = buildPatchFile(meta, working);
  await writeLibraryFile(library, id, patchFileText(file), request.download);
  ctx.change({ [partId]: { preset: id }, patches: { [id]: file.patch } });
  if (wasInit) dropInit(ctx);
  return id;
}

/** Remove a library file; refused for an id game code plays. Songs keep their copies. */
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
