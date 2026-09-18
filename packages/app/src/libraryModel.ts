/**
 * The editor's view of the patch library (#563): the entries the preset
 * browser lists and the actions write to, and where they came from — the
 * connected folder, read at start and after every write, or the library
 * baked into the page. One model, read by the browser, the badge and the
 * actions, so a save shows up everywhere without a rebuild.
 */
import type { Patch, PresetListing } from '../../../packages/client/src/audio/index-for-editor';
import {
  PATCH_LIBRARY,
  loadUnsweptPatchFile,
} from '../../../packages/client/src/audio/index-for-editor';
import type { PatchFolder } from './libraryFolder';
import { readFolderLibrary } from './libraryFolder';
import { LIBRARY_FOLDER_PATH, isInitPreset } from './libraryConstants';
import { downloadPatchFile, patchFileName } from './patchFileWriter';
import type { LibraryEntries } from './patchMetadata';

export type LibraryMode = 'folder' | 'page';

export interface LibraryModel {
  mode: LibraryMode;
  entries: LibraryEntries;
  folder: PatchFolder | null;
  /** The last folder read's load failures, for the status line. */
  problems: string[];
}

/** The one instance the console shares; tests build their own with `pageLibrary()`. */
export const library: LibraryModel = pageLibrary();

export function pageLibrary(): LibraryModel {
  return { mode: 'page', entries: PATCH_LIBRARY, folder: null, problems: [] };
}

export const libraryPatch = (model: LibraryModel, id: string): Patch | undefined =>
  Object.hasOwn(model.entries, id) ? model.entries[id]?.patch : undefined;

/** Point the model at a folder and read it. */
export async function connectLibrary(model: LibraryModel, folder: PatchFolder): Promise<void> {
  model.folder = folder;
  model.mode = 'folder';
  await refreshLibrary(model);
}

/** Back to the library baked into the page. */
export function disconnectLibrary(model: LibraryModel): void {
  Object.assign(model, pageLibrary());
}

/** Re-read the folder (after every write); a no-op in page mode. */
export async function refreshLibrary(model: LibraryModel): Promise<void> {
  if (!model.folder) return;
  const { entries, problems } = await readFolderLibrary(model.folder);
  model.entries = entries;
  model.problems = problems;
}

/**
 * Write one file: into the folder and re-read it, or — with no folder — a
 * download plus the entry kept in memory so the browser reflects it for the
 * rest of the session.
 */
export async function writeLibraryFile(
  model: LibraryModel,
  id: string,
  text: string,
  download: (id: string, text: string) => void = downloadPatchFile,
): Promise<void> {
  if (model.folder) {
    await model.folder.write(patchFileName(id), text);
    await refreshLibrary(model);
    return;
  }
  download(id, text);
  // Through the loader the folder path reads with (#617), not a bare spread:
  // page mode kept the entry in memory unchecked, so a file the folder would
  // have refused — and counted under `problems` for the row to show — became
  // a valid-looking entry in the browser and in every action that reads one.
  // Refused the same way here: no entry, and the reason on the row.
  try {
    model.entries = { ...model.entries, [id]: loadUnsweptPatchFile(id, JSON.parse(text)) };
    model.problems = [];
  } catch (error) {
    model.problems = [error instanceof Error ? error.message : String(error)];
  }
}

/** Remove one file from the folder and re-read it; refused in page mode. */
export async function removeLibraryFile(model: LibraryModel, id: string): Promise<void> {
  if (!model.folder) throw new Error('Delete needs the library folder connected.');
  await model.folder.remove(patchFileName(id));
  await refreshLibrary(model);
}

/** The status line's account of the mode. */
export function libraryModeText(model: LibraryModel): string {
  const count = Object.keys(model.entries).length;
  if (model.folder)
    return `Library: folder "${model.folder.name}" (${count} patches) — Save writes to it`;
  return `Library: baked into the page (${count} patches) — Save downloads <id>.json; connect ${LIBRARY_FOLDER_PATH} to write`;
}

/**
 * The preset browser's listing over these entries: what
 * `presetCatalog.listPresets` produces over the baked library, extended to a
 * folder (`libraryModel.test.ts` pins the two equal on the baked library).
 * Document copies shadow library entries, including when their ids match;
 * a part's Init sentinel is not listed (it is not a patch to load).
 */
export function listLibrary(
  entries: LibraryEntries,
  documentPatches: Readonly<Record<string, Patch>> = {},
): PresetListing[] {
  const ids = [...new Set([...Object.keys(documentPatches), ...Object.keys(entries)])].filter(
    (id) => !isInitPreset(id),
  );
  return ids
    .map((id): PresetListing => {
      const documentPatch = Object.hasOwn(documentPatches, id) ? documentPatches[id] : undefined;
      const entry = Object.hasOwn(entries, id) ? entries[id] : undefined;
      const patch = documentPatch ?? entry?.patch;
      return {
        id,
        name: patch?.name ?? id,
        source: documentPatch ? 'document' : 'built-in',
        category: entry?.category ?? 'Uncategorized',
        tags: entry?.tags ?? [],
        description: documentPatch
          ? 'Saved in this song. ' + (entry?.description ?? 'Your custom patch.')
          : (entry?.description ?? ''),
      };
    })
    .sort(
      (a, b) =>
        Number(b.source === 'document') - Number(a.source === 'document') ||
        a.name.localeCompare(b.name),
    );
}
