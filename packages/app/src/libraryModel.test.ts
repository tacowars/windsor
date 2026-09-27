/**
 * The editor's library model (#563): its listing is the one definition of the
 * preset list (#620 retired `presetCatalog.listPresets`), a folder read
 * replaces the entries, and page mode's writes are downloads the model still
 * reflects.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT } from '../../../packages/client/src/audio/__fixtures__/fullArrangement';
import {
  PATCH_LIBRARY,
  makePatch,
  serialisePatchFile,
} from '../../../packages/client/src/audio/index-for-editor';
import type { PatchFolder } from './libraryFolder';
import {
  connectLibrary,
  disconnectLibrary,
  libraryModeText,
  libraryPatch,
  listLibrary,
  pageLibrary,
  removeLibraryFile,
  writeLibraryFile,
} from './libraryModel';

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
    expect(libraryModeText(model)).toContain('baked into the page');
    const files = new Map([['hat.json', serialisePatchFile(PATCH_LIBRARY['hat']!)]]);
    await connectLibrary(model, memoryFolder(files));
    expect(model.mode).toBe('folder');
    expect(Object.keys(model.entries)).toEqual(['hat']);
    expect(libraryPatch(model, 'kick')).toBeUndefined();
    expect(libraryModeText(model)).toContain('folder "patches" (1 patches)');
    disconnectLibrary(model);
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
    await expect(removeLibraryFile(model, 'kick')).rejects.toThrow('folder');
  });

  it('refuses a page-mode write the folder path would have refused (#617)', async () => {
    const model = pageLibrary();
    const downloads: [string, string][] = [];
    const half = '{"format": 1, "name": "half"}';
    await writeLibraryFile(model, 'half-written', half, (id, body) => downloads.push([id, body]));
    // The file still reaches the disk — it is the user's own Save — but it is
    // not an entry, and the row says so, exactly as the folder read does.
    expect(downloads).toEqual([['half-written', half]]);
    expect(model.entries['half-written']).toBeUndefined();
    expect(model.problems).toHaveLength(1);
    expect(model.problems[0]).toContain('half-written');
  });
});
