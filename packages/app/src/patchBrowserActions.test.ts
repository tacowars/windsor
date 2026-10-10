/**
 * The browser's library actions (windsor#522) over a real document model and
 * an in-memory user library: Rename of a song patch and of a library patch,
 * Delete of a song patch, and Save as… of the selected row's patch.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FULL_ARRANGEMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import { ARRANGEMENT_VERSION, makePatch, partAt } from '@windsor/engine';
import type { DocumentPartial } from '@windsor/engine';
import { loadBuiltIns } from './builtInLibrary';
import { AutoCopies } from './autoCopies';
import type { AppCtx } from './context';
import { DocumentModel } from './documentModel';
import type { PatchFolder } from './libraryFolder';
import { connectUserLibrary, pageLibrary } from './libraryModel';
import { copyToLibrary, deleteSongPatch, renameLibraryPatch } from './patchActions';
import { renamePatch } from './patchLibrary';

beforeAll(() => loadBuiltIns());

function memoryFolder(): PatchFolder {
  const files = new Map<string, string>();
  return {
    name: 'mine',
    list: () => Promise.resolve([...files.keys()]),
    read: (name) => Promise.resolve(files.get(name) ?? ''),
    write: (name, text) => Promise.resolve(void files.set(name, text)),
    remove: (name) => Promise.resolve(void files.delete(name)),
  };
}

function context(): AppCtx {
  const model = new DocumentModel({ version: ARRANGEMENT_VERSION, ...FULL_ARRANGEMENT });
  return {
    model,
    autoCopies: new AutoCopies(),
    change: (partial: DocumentPartial) => {
      model.merge(partial);
      return { ok: true, ignored: [] };
    },
    render: () => {},
    notify: () => {},
  } as unknown as AppCtx;
}

async function userLibrary() {
  const library = pageLibrary();
  await connectUserLibrary(library, memoryFolder());
  return library;
}

const META = { category: 'Pads', tags: ['warm'], description: 'Mine.' };

describe('Rename in the browser', () => {
  it("moves a song patch to the new name's id, its display name with it, and the parts follow", () => {
    const ctx = context();
    renamePatch(ctx, 'kick', 'thump', 'Thump');
    expect(ctx.model.doc.patches?.kick).toBeUndefined();
    expect(ctx.model.doc.patches?.thump?.name).toBe('Thump');
    expect(partAt(ctx.model.doc, FULL_SLOT.kick)?.preset).toBe('thump');
  });

  it('changes only the display name when the id stays', () => {
    const ctx = context();
    renamePatch(ctx, 'kick', 'kick', 'Big Kick');
    expect(ctx.model.doc.patches?.kick?.name).toBe('Big Kick');
    expect(partAt(ctx.model.doc, FULL_SLOT.kick)?.preset).toBe('kick');
  });

  it('renames a library patch in place and refuses a built-in', async () => {
    const library = await userLibrary();
    const id = await copyToLibrary(library, makePatch({ name: 'Soft Pad' }), {
      ...META,
      name: 'Soft Pad',
    });
    await renameLibraryPatch(library, id, 'Softer Pad');
    expect(library.entries[id]).toMatchObject({ name: 'Softer Pad', ...META });
    await expect(renameLibraryPatch(library, 'kick', 'Mine')).rejects.toThrow(/read-only/);
  });
});

describe('Delete of a song patch', () => {
  it('removes a copy no part plays, and refuses one a part plays', () => {
    const ctx = context();
    ctx.change({ patches: { spare: makePatch({ name: 'spare' }) } });
    expect(deleteSongPatch(ctx, 'kick')).toBe(false);
    expect(ctx.model.doc.patches?.kick).toBeDefined();
    expect(deleteSongPatch(ctx, 'spare')).toBe(true);
    expect(ctx.model.doc.patches?.spare).toBeUndefined();
  });
});

describe('Save as… in the browser', () => {
  it("writes the row's patch to a new library id clear of the song's, and switches no part", async () => {
    const library = await userLibrary();
    const ctx = context();
    const patch = ctx.model.doc.patches!.hat!;
    const id = await copyToLibrary(library, patch, { ...META, name: 'Kick' }, ['kick']);
    expect(id).toBe('kick-2');
    expect(library.entries[id]?.patch.ops).toEqual(patch.ops);
    expect(library.userIds.has(id)).toBe(true);
    expect(partAt(ctx.model.doc, FULL_SLOT.hat)?.preset).toBe('hat');
  });
});
