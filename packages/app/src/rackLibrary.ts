/**
 * The library model's rack side (windsor#868, record `2026-10-17-racks`
 * decision 15): the user's racks in IndexedDB read through the engine's one
 * rack loader, beside the patches `libraryModel.ts` reads, under the built-in
 * bank (windsor#877, decision 16) as the user's patches sit under the built-in
 * patches. The developer's folder grant replaces both while connected, as it
 * does for the patches. The stores are `PatchFolder`s under other names, so
 * the model and the tests reuse the folder abstraction and its in-memory
 * fakes.
 */
import type { BuiltInRacks, RackEntry } from '@windsor/engine';
import { loadRackFile } from '@windsor/engine';
import { builtInRackEntries } from './builtInRacks';
import type { OldFormatPatch, PatchFolder } from './libraryFolder';
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

/** True when a write may go over `id`: a rack of the connected folder, else one of the user's own. */
export const isRackWritable = (model: LibraryModel, id: string): boolean =>
  model.rackFolder ? Object.hasOwn(model.racks, id) : model.userRackIds.has(id);

/** The store a write goes to: the folder while connected, else the user's; null without either. */
const rackStore = (model: LibraryModel): PatchFolder | null => model.rackFolder ?? model.userRacks;

/** What a loaded rack's own soft problems (a clamp, a dropped key) read as in the library line. */
const entryNotes = (entries: RackEntries): string[] =>
  Object.values(entries).flatMap((entry) =>
    entry.problems.map((note) => `rack "${entry.id}": ${note}`),
  );

/**
 * Re-read the racks (after every write): the connected folder's, every one
 * writable; else the built-ins with the user's own over them, a user rack
 * whose id a built-in has staying hidden behind it and named under
 * `rackProblems`, as `refreshLibrary` keeps a built-in patch unshadowed. A
 * rack the loader refuses is named under `rackProblems`; one it loaded with a
 * correction is in `racks` and named under `rackNotes`; one of a format this
 * build cannot read is kept under `oldFormatRacks`.
 */
export const refreshRacks = tracked(async function refreshRacks(
  model: LibraryModel,
): Promise<void> {
  const { builtInRacks: builtIns } = model;
  const store = rackStore(model);
  if (!store) {
    model.racks = builtIns;
    model.userRackIds = new Set();
    model.rackProblems = [];
    model.rackNotes = entryNotes(builtIns);
    model.oldFormatRacks = [];
    return;
  }
  const { entries, problems, oldFormat } = await readFolderWith(store, loadRackFile);
  model.oldFormatRacks = oldFormat;
  if (model.rackFolder) {
    model.racks = entries;
    model.userRackIds = new Set(Object.keys(entries));
    model.rackProblems = problems;
    model.rackNotes = entryNotes(entries);
    return;
  }
  const clashes = Object.keys(entries).filter((id) => Object.hasOwn(builtIns, id));
  const own = Object.fromEntries(
    Object.entries(entries).filter(([id]) => !Object.hasOwn(builtIns, id)),
  );
  model.racks = { ...builtIns, ...own };
  model.userRackIds = new Set(Object.keys(own));
  model.rackProblems = [
    ...problems,
    ...clashes.map((id) => `your rack "${id}" is hidden by the built-in of the same id`),
  ];
  model.rackNotes = entryNotes(model.racks);
});

/**
 * Attach the user's rack store (null where the browser has none) under the
 * shipped bank, as loaded by then, and read it. `builtIns` is a parameter so a
 * test can bring its own bank.
 */
export function connectUserRacks(
  model: LibraryModel,
  racks: PatchFolder | null,
  builtIns: BuiltInRacks = builtInRackEntries(),
): Promise<void> {
  model.builtInRacks = builtIns;
  model.userRacks = racks;
  return refreshRacks(model);
}

/** Point the racks at the grant's `racks/` folder and read it; the built-ins and the user's give way. */
export function connectRackFolder(model: LibraryModel, folder: PatchFolder): Promise<void> {
  model.rackFolder = folder;
  return refreshRacks(model);
}

/** Back to the built-ins and the user's racks. */
export function disconnectRackFolder(model: LibraryModel): Promise<void> {
  model.rackFolder = null;
  return refreshRacks(model);
}

/**
 * Write one rack file into the folder or the user's store and re-read it,
 * or, with neither (a browser without IndexedDB), a download plus the entry
 * kept in memory for the rest of the session, through the loader so a file
 * it would refuse never becomes an entry. A built-in id is refused outside
 * the folder: built-ins are never shadowed.
 */
export const writeRackFile = tracked(async function writeRackFile(
  model: LibraryModel,
  id: string,
  text: string,
  download: (id: string, text: string) => void = downloadRackFile,
): Promise<void> {
  if (rackEntry(model, id) && !isRackWritable(model, id))
    throw new Error(`"${id}" is a built-in rack and stays read-only.`);
  const store = rackStore(model);
  if (store) {
    await store.write(rackFileName(id), text);
    await refreshRacks(model);
    return;
  }
  download(id, text);
  try {
    const entry = loadRackFile(id, JSON.parse(text));
    model.racks = { ...model.racks, [id]: entry };
    model.userRackIds = new Set([...model.userRackIds, id]);
    model.rackProblems = [];
    model.rackNotes = entryNotes({ [id]: entry });
  } catch (error) {
    model.rackProblems = [error instanceof Error ? error.message : String(error)];
    model.rackNotes = [];
  }
});

/** An old-format rack by id, or undefined. */
export const oldFormatRack = (model: LibraryModel, id: string): OldFormatPatch | undefined =>
  model.oldFormatRacks.find((entry) => entry.id === id);

/** Export an old-format rack: its stored text, byte for byte, as `<id>.json`. */
export function exportOldFormatRack(
  model: LibraryModel,
  id: string,
  download: (id: string, text: string) => void = downloadRackFile,
): void {
  const entry = oldFormatRack(model, id);
  if (!entry) throw new Error(`"${id}" is not an old-format rack in this library.`);
  download(id, entry.text);
}

/** Delete an old-format rack from its store, on the user's word, and re-read. */
export const removeOldFormatRack = tracked(
  async (model: LibraryModel, id: string): Promise<void> => {
    const store = rackStore(model);
    if (!store || !oldFormatRack(model, id))
      throw new Error(`"${id}" is not an old-format rack in this library.`);
    await store.remove(rackFileName(id));
    await refreshRacks(model);
  },
);

/** Remove a writable rack and re-read; refused without a store or for an id that is not writable. */
export const removeRackFile = tracked(async (model: LibraryModel, id: string): Promise<void> => {
  const store = rackStore(model);
  if (!store) throw new Error('This browser cannot store racks, so there is none to delete.');
  if (!isRackWritable(model, id)) throw new Error(`"${id}" is not one of your racks.`);
  await store.remove(rackFileName(id));
  await refreshRacks(model);
});
