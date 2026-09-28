/**
 * The editor's library model (#563): its listing is the one definition of the
 * preset list (#620 retired `presetCatalog.listPresets`), a folder read
 * replaces the entries, and page mode's writes are downloads the model still
 * reflects.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT } from '@windsor/engine/__fixtures__/fullArrangement';
import { makePatch, serialisePatchFile } from '@windsor/engine';
import { PATCH_LIBRARY } from '@windsor/engine/patch/presets';
import type { PatchFolder } from './libraryFolder';
import {
  connectLibrary,
  connectUserLibrary,
  disconnectLibrary,
  isWritable,
  libraryProblemsText,
  libraryPatch,
  listLibrary,
  pageLibrary,
  removeLibraryFile,
  writeLibraryFile,
} from './libraryModel';
import { loadBuiltIns } from './builtInLibrary';
import { buildPatchFile, patchFileText } from './patchFileWriter';

// The built-in library loads on demand in the page; these tests read it.
beforeAll(() => loadBuiltIns());

/** The entry minus its headroom record: what a file looks like before its sweep. */
const withoutHeadroom = <T extends { headroom?: unknown }>(entry: T): Omit<T, 'headroom'> =>
  Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'headroom')) as Omit<
    T,
    'headroom'
  >;

function memoryFolder(files: Map<string, string>): PatchFolder {
  return {
    name: 'patches',
    list: () => Promise.resolve([...files.keys()]),
    read: (name) => Promise.resolve(files.get(name) ?? ''),
    write: (name, text) => {
      files.set(name, text);
      return Promise.resolve();
    },
    remove: (name) => {
      files.delete(name);
      return Promise.resolve();
    },
  };
}

describe('listLibrary', () => {
  it('lists document shadows once and first, uses their names, and includes custom patches', () => {
    const documentPatches = {
      ...(FULL_ARRANGEMENT as { patches?: Record<string, never> }).patches,
      kick: makePatch({ name: 'My Kick' }),
      custom: makePatch({ name: 'Custom' }),
    };
    const entries = listLibrary(PATCH_LIBRARY, documentPatches);
    expect(entries.filter((entry) => entry.id === 'kick')).toHaveLength(1);
    expect(entries.find((entry) => entry.id === 'kick')).toMatchObject({
      name: 'My Kick',
      source: 'document',
      category: PATCH_LIBRARY['kick']?.category,
    });
    expect(entries.find((entry) => entry.id === 'custom')).toMatchObject({
      name: 'Custom',
      source: 'document',
      category: 'Uncategorized',
    });
    const firstBuiltIn = entries.findIndex((entry) => entry.source === 'built-in');
    expect(entries.slice(0, firstBuiltIn).every((entry) => entry.source === 'document')).toBe(true);
    expect(entries.slice(firstBuiltIn).every((entry) => entry.source === 'built-in')).toBe(true);
    // The baked library alone: every entry, none of them a document copy.
    const baked = listLibrary(PATCH_LIBRARY);
    expect(baked.map((entry) => entry.id).sort()).toEqual(Object.keys(PATCH_LIBRARY).sort());
    expect(baked.every((entry) => entry.source === 'built-in')).toBe(true);
  });
});

describe('the model', () => {
  it('starts on the page library and reads a connected folder instead', async () => {
    const model = pageLibrary();
    expect(model.mode).toBe('page');
    expect(libraryPatch(model, 'kick')).toBe(PATCH_LIBRARY['kick']?.patch);
    expect(Object.keys(model.entries)).toHaveLength(159);
    const files = new Map([['hat.json', serialisePatchFile(PATCH_LIBRARY['hat']!)]]);
    await connectLibrary(model, memoryFolder(files));
    expect(model.mode).toBe('folder');
    expect(Object.keys(model.entries)).toEqual(['hat']);
    expect(libraryPatch(model, 'kick')).toBeUndefined();
    await disconnectLibrary(model);
    expect(model.mode).toBe('page');
    expect(libraryPatch(model, 'kick')).toBeDefined();
  });

  it('writes to the folder and re-reads it; removes likewise', async () => {
    const model = pageLibrary();
    const files = new Map<string, string>();
    await connectLibrary(model, memoryFolder(files));
    const unswept = withoutHeadroom(PATCH_LIBRARY['kick']!);
    await writeLibraryFile(model, 'kick', serialisePatchFile(unswept));
    expect(files.has('kick.json')).toBe(true);
    expect(model.entries['kick']?.headroom).toBeUndefined();
    await removeLibraryFile(model, 'kick');
    expect(files.size).toBe(0);
    expect(model.entries['kick']).toBeUndefined();
  });

  it('downloads in page mode and keeps the entry for the session; delete is refused', async () => {
    const model = pageLibrary();
    const downloads: [string, string][] = [];
    const text = serialisePatchFile(PATCH_LIBRARY['kick']!);
    await writeLibraryFile(model, 'kick-2', text, (id, body) => downloads.push([id, body]));
    expect(downloads).toEqual([['kick-2', text]]);
    expect(model.entries['kick-2']?.id).toBe('kick-2');
    expect(model.problems).toEqual([]);
    expect(PATCH_LIBRARY['kick-2']).toBeUndefined();
    await expect(removeLibraryFile(model, 'kick')).rejects.toThrow('cannot store');
  });

  it('refuses a page-mode write the folder path would have refused (#617)', async () => {
    const model = pageLibrary();
    const downloads: [string, string][] = [];
    const half = '{"format": 1, "name": "half"}';
    await writeLibraryFile(model, 'half-written', half, (id, body) => downloads.push([id, body]));
    // The file still reaches the disk — it is the user's own Save — but it is
    // not an entry, and a toast says so, exactly as the folder read does.
    expect(downloads).toEqual([['half-written', half]]);
    expect(model.entries['half-written']).toBeUndefined();
    expect(model.problems).toHaveLength(1);
    expect(model.problems[0]).toContain('half-written');
    expect(libraryProblemsText(model)).toMatch(
      /^library: 1 patch file\(s\) refused — .*half-written/,
    );
  });

  it('has no problem toast for a clean read', () => {
    expect(libraryProblemsText(pageLibrary())).toBeNull();
  });
});

describe("the user's library", () => {
  /** A user patch file, as Save writes it: the kick under a new name, with no headroom record. */
  const mine = (name: string): string =>
    patchFileText(
      buildPatchFile(
        { name, category: 'Drums', tags: ['kick'], description: '' },
        PATCH_LIBRARY['kick']!.patch,
      ),
    );

  it('lists beside the built-ins as source "library", and only its own ids are writable', async () => {
    const files = new Map([['my-kick.json', mine('My Kick')]]);
    const model = pageLibrary();
    await connectUserLibrary(model, memoryFolder(files));
    expect(model.mode).toBe('page');
    expect(model.entries['kick']).toBeDefined();
    expect(model.entries['my-kick']?.name).toBe('My Kick');
    expect([...model.userIds]).toEqual(['my-kick']);
    expect(isWritable(model, 'my-kick')).toBe(true);
    expect(isWritable(model, 'kick')).toBe(false);
    const listing = listLibrary(model.entries, {}, model.userIds);
    expect(listing.find((entry) => entry.id === 'my-kick')?.source).toBe('library');
    expect(listing.find((entry) => entry.id === 'kick')?.source).toBe('built-in');
  });

  it('writes and removes its own ids, and refuses a built-in either way', async () => {
    const files = new Map<string, string>();
    const model = pageLibrary();
    await connectUserLibrary(model, memoryFolder(files));
    await writeLibraryFile(model, 'soft-kick', mine('Soft Kick'));
    expect(files.has('soft-kick.json')).toBe(true);
    expect(model.userIds.has('soft-kick')).toBe(true);
    await expect(writeLibraryFile(model, 'kick', mine('FM Kick'))).rejects.toThrow('read-only');
    await expect(removeLibraryFile(model, 'kick')).rejects.toThrow('read-only');
    expect(files.has('kick.json')).toBe(false);
    await removeLibraryFile(model, 'soft-kick');
    expect(files.size).toBe(0);
    expect(model.entries['soft-kick']).toBeUndefined();
    expect(model.entries['kick']).toBeDefined();
  });

  it('never lets a stored id shadow a built-in, and says so', async () => {
    const files = new Map([['kick.json', mine('Not The Kick')]]);
    const model = pageLibrary();
    await connectUserLibrary(model, memoryFolder(files));
    expect(model.entries['kick']).toBe(PATCH_LIBRARY['kick']);
    expect(model.userIds.has('kick')).toBe(false);
    expect(model.problems).toEqual(['your patch "kick" is hidden by the built-in of the same id']);
    expect(libraryProblemsText(model)).toBe(
      'library: 1 patch file(s) refused — your patch "kick" is hidden by the built-in of the same id',
    );
  });

  it('gives way to a connected folder, and comes back when it is forgotten', async () => {
    const files = new Map([['my-kick.json', mine('My Kick')]]);
    const model = pageLibrary();
    await connectUserLibrary(model, memoryFolder(files));
    await connectLibrary(model, memoryFolder(new Map()));
    expect(model.entries['my-kick']).toBeUndefined();
    await disconnectLibrary(model);
    expect(model.entries['my-kick']?.name).toBe('My Kick');
    expect(model.userIds.has('my-kick')).toBe(true);
  });
});
