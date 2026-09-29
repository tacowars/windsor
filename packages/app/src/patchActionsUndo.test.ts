/**
 * Copy to new as one undo step (windsor#130 decision 7), over a real
 * `AppContext` and an empty in-memory user library: the switch to the copy
 * and the Init discard it sets off undo together.
 */
import { describe, expect, it } from 'vitest';

import { partAt } from '@windsor/engine';
import { openGestureConsole } from './__fixtures__/gestureConsole';
import type { PatchFolder } from './libraryFolder';
import type { LibraryModel } from './libraryModel';
import { connectUserLibrary, pageLibrary } from './libraryModel';
import { copyToNew, initPatchDefaults } from './patchActions';

/** An empty in-memory store. */
function emptyStore(): PatchFolder {
  const files = new Map<string, string>();
  return {
    name: 'patches',
    list: () => Promise.resolve([...files.keys()]),
    read: (name) => Promise.resolve(files.get(name) ?? Promise.reject(new Error(name))),
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

describe('Copy to new as an undo step', () => {
  it('is one step from an Init part, the Init discard it sets off included', async () => {
    const library: LibraryModel = pageLibrary();
    await connectUserLibrary(library, emptyStore());
    const ctx = openGestureConsole();
    const before = ctx.model.doc;
    const init = partAt(before, 0)?.preset ?? '';
    const id = await copyToNew({
      ctx,
      library,
      slot: 0,
      working: initPatchDefaults(),
      meta: { name: 'Mine', category: '', tags: [], description: '' },
    });
    // Two edits: the part switched to the copy, and its Init dropped.
    expect(partAt(ctx.model.doc, 0)?.preset).toBe(id);
    expect(ctx.model.doc.patches?.[init]).toBeUndefined();
    expect(ctx.undoLabel).toBe('Copy to new');
    expect(ctx.undo()).toBe(true);
    expect(ctx.model.doc).toEqual(before);
    expect(ctx.canUndo).toBe(false);
  });
});
