/**
 * What Save and Copy to new write (#563): a `patches/<id>.json` built from
 * the working patch and the modal's metadata, serialised by the audio
 * package's one serialiser so the bytes match every other writer's, and —
 * when no folder is connected — handed to the browser as a download.
 */
import type { Patch, PatchFile } from '@windsor/engine';
import { PATCH_FILE_FORMAT, makePatch, serialisePatchFile } from '@windsor/engine';
import type { PatchMetadata } from './patchMetadata';

/**
 * The file for a patch under new metadata. The patch is renormalised with the
 * display name as its `name` (the loader demands the two agree).
 */
export function buildPatchFile(meta: PatchMetadata, patch: Patch): PatchFile {
  return {
    format: PATCH_FILE_FORMAT,
    name: meta.name,
    category: meta.category,
    tags: [...meta.tags],
    description: meta.description,
    patch: makePatch({ ...structuredClone(patch), name: meta.name }),
  };
}

export const patchFileText = (file: PatchFile): string => serialisePatchFile(file);

/** The download's body: the file bytes as JSON. */
export function patchFileBlob(text: string): Blob {
  return new Blob([text], { type: 'application/json' });
}

export const patchFileName = (id: string): string => `${id}.json`;

/** Hand `<id>.json` to the browser's download path (the no-folder mode). */
export function downloadPatchFile(id: string, text: string): void {
  const url = URL.createObjectURL(patchFileBlob(text));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = patchFileName(id);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
