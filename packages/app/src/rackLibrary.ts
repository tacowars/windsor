/**
 * The library model's rack side (windsor#868, record `2026-10-17-racks`
 * decision 15): the user's racks in IndexedDB read through the engine's one
 * rack loader, beside the patches `libraryModel.ts` reads. The store is a
 * `PatchFolder` under a second name, so the model and the tests reuse the
 * folder abstraction and its in-memory fakes. Built-in racks are a later
 * issue's and join here, under the user's own, as the built-in patches do.
 */
import type { RackEntry } from '@windsor/engine';
import { loadRackFile } from '@windsor/engine';
import type { PatchFolder } from './libraryFolder';
import { readFolderWith } from './libraryFolder';
import type { LibraryModel } from './libraryModel';
import { tracked } from './libraryModel';
import { downloadPatchFile, patchFileName } from './patchFileWriter';

export type RackEntries = Readonly<Record<string, RackEntry>>;

/** A rack file is `<id>.json`, as a patch file is; a download of one is the same blob. */
export const rackFileName = patchFileName;
export const downloadRackFile = downloadPatchFile;

/** The rack by id, or undefined. */
export const rackEntry = (model: LibraryModel, id: string): RackEntry | undefined =>
  Object.hasOwn(model.racks, id) ? model.racks[id] : undefined;

/** True when a write may go over `id`: one of the user's own racks. */
export const isRackWritable = (model: LibraryModel, id: string): boolean =>
  model.userRackIds.has(id);

/** What a loaded rack's own soft problems (a clamp, a dropped key) read as in the library line. */
const entryNotes = (entries: RackEntries): string[] =>
  Object.values(entries).flatMap((entry) =>
    entry.problems.map((note) => `rack "${entry.id}": ${note}`),
  );

/**
 * Re-read the user's rack store (after every write). Without one the racks
 * are none. A rack the loader refuses is named under `rackProblems`; one of
 * a format this build cannot read is kept under `oldFormatRacks`.
 */
export const refreshRacks = tracked(async (model: LibraryModel): Promise<void> => {
  if (!model.userRacks) {
    model.racks = {};
    model.userRackIds = new Set();
    model.rackProblems = [];
    model.oldFormatRacks = [];
    return;
  }
  const { entries, problems, oldFormat } = await readFolderWith(model.userRacks, loadRackFile);
  model.racks = entries;
  model.userRackIds = new Set(Object.keys(entries));
  model.rackProblems = [...problems, ...entryNotes(entries)];
  model.oldFormatRacks = oldFormat;
});

/** Attach the user's rack store (null where the browser has none) and read it. */
export function connectUserRacks(model: LibraryModel, racks: PatchFolder | null): Promise<void> {
  model.userRacks = racks;
  return refreshRacks(model);
}

/**
 * Write one rack file into the user's store and re-read it, or, with no
 * store (a browser without IndexedDB), a download plus the entry kept in
 * memory for the rest of the session, through the loader so a file it
 * would refuse never becomes an entry.
 */
export const writeRackFile = tracked(async function writeRackFile(
  model: LibraryModel,
  id: string,
  text: string,
  download: (id: string, text: string) => void = downloadRackFile,
): Promise<void> {
  if (model.userRacks) {
    await model.userRacks.write(rackFileName(id), text);
    await refreshRacks(model);
    return;
  }
  download(id, text);
  try {
    const entry = loadRackFile(id, JSON.parse(text));
    model.racks = { ...model.racks, [id]: entry };
    model.userRackIds = new Set([...model.userRackIds, id]);
    model.rackProblems = entryNotes({ [id]: entry });
  } catch (error) {
    model.rackProblems = [error instanceof Error ? error.message : String(error)];
  }
});

/** Remove one of the user's racks and re-read; refused without a store or for an id that is not the user's. */
export const removeRackFile = tracked(async (model: LibraryModel, id: string): Promise<void> => {
  if (!model.userRacks)
    throw new Error('This browser cannot store racks, so there is none to delete.');
  if (!isRackWritable(model, id)) throw new Error(`"${id}" is not one of your racks.`);
  await model.userRacks.remove(rackFileName(id));
  await refreshRacks(model);
});
