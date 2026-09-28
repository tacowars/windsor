/**
 * The editor's view of the patch library (#563): the entries the preset
 * browser lists and the actions write to, and where they came from. In page
 * mode that is the built-ins plus the user's own library in IndexedDB
 * (`2026-09-27-user-library-in-indexeddb`); in folder mode, the developer's
 * File System Access grant on the repo's patches, which replaces both while
 * connected. Either store is read at start and after every write. One model,
 * read by the browser, the badge and the actions, so a save shows up
 * everywhere without a rebuild.
 */
import type { Patch, PresetListing } from '@windsor/engine';
import { loadUnsweptPatchFile } from '@windsor/engine';
import { builtInEntries, loadBuiltIns } from './builtInLibrary';
import type { PatchFolder } from './libraryFolder';
import { readFolderLibrary } from './libraryFolder';
import { isInitPreset } from './libraryConstants';
import { downloadPatchFile, patchFileName } from './patchFileWriter';
import type { LibraryEntries } from './patchMetadata';

export type LibraryMode = 'folder' | 'page';

export interface LibraryModel {
  mode: LibraryMode;
  entries: LibraryEntries;
  folder: PatchFolder | null;
  /** The user's library in IndexedDB; null until connected, or when the browser has no IndexedDB. */
  user: PatchFolder | null;
  /** The ids in `entries` that are the user's own, writable in page mode; built-ins never are. */
  userIds: ReadonlySet<string>;
  /** The last folder read's load failures, for the status line. */
  problems: string[];
}

/** The one instance the console shares; tests build their own with `pageLibrary()`. */
export const library: LibraryModel = pageLibrary();

export function pageLibrary(user: PatchFolder | null = null): LibraryModel {
  return {
    mode: 'page',
    entries: builtInEntries(),
    folder: null,
    user,
    userIds: new Set(),
    problems: [],
  };
}

export const libraryPatch = (model: LibraryModel, id: string): Patch | undefined =>
  Object.hasOwn(model.entries, id) ? model.entries[id]?.patch : undefined;

/**
 * True when a write may go over `id`: any file in the connected folder, or a
 * user patch in page mode. A built-in in page mode is read-only — Save forks
 * it to a new id instead (decision 1 of the user-library record).
 */
export const isWritable = (model: LibraryModel, id: string): boolean =>
  model.folder ? Object.hasOwn(model.entries, id) : model.userIds.has(id);

/** Load the built-ins, and show them (with the user's patches) if the model is on the page library. */
export async function loadPageLibrary(model: LibraryModel): Promise<void> {
  await loadBuiltIns();
  if (model.mode === 'page') await refreshLibrary(model);
}

/** Attach the user's library store and read it in beside the built-ins. */
export async function connectUserLibrary(model: LibraryModel, user: PatchFolder): Promise<void> {
  model.user = user;
  await refreshLibrary(model);
}

/** Point the model at a folder and read it. */
export async function connectLibrary(model: LibraryModel, folder: PatchFolder): Promise<void> {
  model.folder = folder;
  model.mode = 'folder';
  await refreshLibrary(model);
}

/** Back to the built-ins and the user's library. */
export async function disconnectLibrary(model: LibraryModel): Promise<void> {
  Object.assign(model, pageLibrary(model.user));
  await refreshLibrary(model);
}

/**
 * Re-read the store the model is on (after every write): the folder, or the
 * user's library over the built-ins. A user id a built-in also has stays
 * hidden behind the built-in — built-ins are never shadowed — and is named
 * under `problems`.
 */
export async function refreshLibrary(model: LibraryModel): Promise<void> {
  if (model.folder) {
    const { entries, problems } = await readFolderLibrary(model.folder);
    model.entries = entries;
    model.problems = problems;
    return;
  }
  const builtIns = builtInEntries();
  if (!model.user) {
    model.entries = builtIns;
    return;
  }
  const { entries, problems } = await readFolderLibrary(model.user);
  const clashes = Object.keys(entries).filter((id) => Object.hasOwn(builtIns, id));
  const own = Object.fromEntries(
    Object.entries(entries).filter(([id]) => !Object.hasOwn(builtIns, id)),
  );
  model.entries = { ...builtIns, ...own };
  model.userIds = new Set(Object.keys(own));
  model.problems = [
    ...problems,
    ...clashes.map((id) => `your patch "${id}" is hidden by the built-in of the same id`),
  ];
}

/**
 * Write one file: into the folder or the user's library and re-read it, or —
 * with neither (a browser without IndexedDB) — a download plus the entry kept
 * in memory so the browser reflects it for the rest of the session. A
 * built-in id is refused in page mode: built-ins are never shadowed.
 */
export async function writeLibraryFile(
  model: LibraryModel,
  id: string,
  text: string,
  download: (id: string, text: string) => void = downloadPatchFile,
): Promise<void> {
  if (!model.folder && Object.hasOwn(builtInEntries(), id))
    throw new Error(`"${id}" is a built-in patch and stays read-only.`);
  const store = model.folder ?? model.user;
  if (store) {
    await store.write(patchFileName(id), text);
    await refreshLibrary(model);
    return;
  }
  download(id, text);
  // Through the loader the folder path reads with (#617), not a bare spread:
  // page mode kept the entry in memory unchecked, so a file the folder would
  // have refused — and counted under `problems` for a toast to report — became
  // a valid-looking entry in the browser and in every action that reads one.
  // Refused the same way here: no entry, and the reason in a toast.
  try {
    model.entries = { ...model.entries, [id]: loadUnsweptPatchFile(id, JSON.parse(text)) };
    model.userIds = new Set([...model.userIds, id]);
    model.problems = [];
  } catch (error) {
    model.problems = [error instanceof Error ? error.message : String(error)];
  }
}

/** Remove one of the user's patches, or a folder file, and re-read; a built-in is refused. */
export async function removeLibraryFile(model: LibraryModel, id: string): Promise<void> {
  const store = model.folder ?? model.user;
  if (!store) throw new Error('This browser cannot store patches, so there is none to delete.');
  if (!isWritable(model, id)) throw new Error(`"${id}" is a built-in patch and stays read-only.`);
  await store.remove(patchFileName(id));
  await refreshLibrary(model);
}

/** The warning toast for the patch files the last library read refused, or null when it refused none. */
export function libraryProblemsText(model: LibraryModel): string | null {
  const { problems } = model;
  if (!problems.length) return null;
  return `library: ${problems.length} patch file(s) refused — ${problems.join('; ')}`;
}

/** Raises an `error` toast; the one `ctx.notify` call a problem report needs. */
export type ProblemNotify = (message: string, tone: 'error') => void;

/** Reports the model's refusals; `force` says them again even when unchanged. */
export type ProblemReporter = (model: LibraryModel, notify: ProblemNotify, force?: boolean) => void;

/**
 * The refusal report, holding what it last said. Refusals leave patches
 * missing, so they are an `error` toast, which stays until dismissed. The
 * same set is said once across re-renders, and again only when it changes or
 * on `force` (an explicit "Re-read folder" that finds it still there).
 */
export function createProblemReporter(): ProblemReporter {
  let reported: string | null = null;
  return (model, notify, force = false) => {
    const text = libraryProblemsText(model);
    if (text !== null && (force || text !== reported)) notify(text, 'error');
    reported = text;
  };
}

function sourceOf(
  id: string,
  inDocument: boolean,
  userIds: ReadonlySet<string>,
): PresetListing['source'] {
  if (inDocument) return 'document';
  return userIds.has(id) ? 'library' : 'built-in';
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
  userIds: ReadonlySet<string> = new Set(),
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
        source: sourceOf(id, documentPatch !== undefined, userIds),
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
