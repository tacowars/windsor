/**
 * The boot marks the user's library pending before its first await
 * (windsor#669): a song imported while IndexedDB is still opening waits for
 * the user's patches before its split, so a shared user patch keeps its
 * source and gets a free id. The database open is faked; the stores are
 * in memory.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ARRANGEMENT_VERSION, makePatch, partAt, serialisePatchFile } from '@windsor/engine';
import { PATCH_LIBRARY } from '@windsor/engine/patch/presets';
import { openGestureConsole } from './__fixtures__/gestureConsole';
import { memorySessionStore, memorySongRecords } from './__fixtures__/memorySongStores';
import type { PatchFolder } from './libraryFolder';
import {
  awaitUserLibrary,
  connectLibrary,
  library,
  loadPageLibrary,
  pageLibrary,
} from './libraryModel';
import type { UserStores } from './userLibraryStore';
import { bootUserState } from './userSession';

const open = vi.hoisted(() => ({ stores: Promise.resolve(null as unknown) }));
vi.mock('./userLibraryStore', () => ({ openUserStores: () => open.stores }));

beforeAll(() => loadPageLibrary(library));

afterEach(async () => {
  vi.unstubAllGlobals();
  Object.assign(library, pageLibrary());
  awaitUserLibrary(Promise.resolve());
  await loadPageLibrary(library);
});

const userFile = (id: string): string => {
  const kick = PATCH_LIBRARY['kick']!;
  return serialisePatchFile({ ...kick, name: id, patch: { ...kick.patch, name: id } });
};

function userPatches(): PatchFolder {
  const files = new Map(['user-bell', 'user-bell-2'].map((id) => [`${id}.json`, userFile(id)]));
  return {
    name: 'user',
    list: () => Promise.resolve([...files.keys()]),
    read: (name) => Promise.resolve(files.get(name)!),
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  };
}

const part = (slot: number) => ({
  slot,
  name: `Lead ${slot}`,
  preset: 'user-bell',
  sequencer: { kind: 'none' },
  regions: [],
});

describe('bootUserState', () => {
  it('holds an import made during a slow database open until the user library has loaded', async () => {
    // The page's hooks need a document and a window; Node has neither.
    vi.stubGlobal('document', new EventTarget());
    vi.stubGlobal('window', new EventTarget());
    let opened = (_stores: UserStores): void => undefined;
    open.stores = new Promise((resolve) => (opened = resolve));
    const ctx = openGestureConsole();
    const booting = bootUserState(ctx, Promise.resolve());
    const imported = ctx.importDoc({
      version: ARRANGEMENT_VERSION,
      parts: [part(0), part(1)],
      patches: { 'user-bell': makePatch({ name: 'Ice Needle' }) },
    });
    const songs = memorySessionStore();
    opened({ patches: userPatches(), songs, library: memorySongRecords(songs) });
    expect(await imported).toBe(true);
    await booting;
    expect(partAt(ctx.model.doc, 1)).toMatchObject({
      preset: 'user-bell-3',
      patchSource: 'user-bell',
    });
  });
});

describe('a library folder connected after boot', () => {
  it('holds an import made during its read until the folder’s ids have loaded', async () => {
    const ctx = openGestureConsole();
    await ctx.importDoc({ version: ARRANGEMENT_VERSION, parts: [] });
    let listed = (): void => undefined;
    const slow = new Promise<void>((resolve) => (listed = resolve));
    const folder = userPatches();
    const list = folder.list;
    folder.list = () => slow.then(list);
    const connecting = connectLibrary(library, folder);
    const imported = ctx.importDoc({
      version: ARRANGEMENT_VERSION,
      parts: [part(0), part(1)],
      patches: { 'user-bell': makePatch({ name: 'Ice Needle' }) },
    });
    listed();
    await connecting;
    expect(await imported).toBe(true);
    expect(partAt(ctx.model.doc, 1)).toMatchObject({
      preset: 'user-bell-3',
      patchSource: 'user-bell',
    });
  });
});
