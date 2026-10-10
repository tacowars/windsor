/**
 * The library actions on a part playing its own copy of a library patch
 * (windsor#669 decision 4): the origin, the modified marker's baseline and
 * Save reach the library entry its `patchSource` names; Save, Discard and
 * Revert write only this part's copy; Save as… and Init drop the link; and a
 * deleted entry leaves the copy a document patch.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import type { DocumentPartial, Patch } from '@windsor/engine';
import { ARRANGEMENT_VERSION, clonePatch, partAt, serialisePatchFile } from '@windsor/engine';
import { PATCH_LIBRARY } from '@windsor/engine/patch/presets';
import { loadBuiltIns } from './builtInLibrary';
import type { AppCtx } from './context';
import { DocumentModel } from './documentModel';
import type { PatchFolder } from './libraryFolder';
import type { LibraryModel } from './libraryModel';
import { connectLibrary, pageLibrary } from './libraryModel';
import {
  copyToNew,
  deletePatch,
  discardEdits,
  initPatch,
  isModified,
  patchOrigin,
  savePatch,
} from './patchActions';
import { revertPatch } from './patchLibrary';

beforeAll(() => loadBuiltIns());

const { kick, hat, arp } = FULL_SLOT;

function folder(): PatchFolder & { files: Map<string, string> } {
  const files = new Map([['kick.json', serialisePatchFile(PATCH_LIBRARY['kick']!)]]);
  return {
    name: 'patches',
    files,
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

/**
 * A folder library holding `kick`, and a song where the kick part plays it,
 * and the hat and the arp each play their own copy of it, linked back.
 */
async function linkedScope() {
  const files = folder();
  const library: LibraryModel = pageLibrary();
  await connectLibrary(library, files);
  const model = new DocumentModel({ version: ARRANGEMENT_VERSION, ...FULL_ARRANGEMENT });
  const ctx = {
    model,
    change: (partial: DocumentPartial) => {
      model.merge(partial);
      return { ok: true, ignored: [] };
    },
    render: () => {},
    notify: () => {},
  } as unknown as AppCtx;
  const entry = library.entries['kick']!.patch;
  model.merge({
    parts: {
      [hat]: { preset: 'kick-2', patchSource: 'kick' },
      [arp]: { preset: 'kick-3', patchSource: 'kick' },
    },
    patches: { kick: clonePatch(entry), 'kick-2': clonePatch(entry), 'kick-3': clonePatch(entry) },
  } as DocumentPartial);
  return { ctx, library, files, slot: hat };
}

const patchOf = (ctx: AppCtx, id: string): Patch | undefined => ctx.model.doc.patches?.[id];
const META = { name: 'Kick', category: 'Drums', tags: [], description: '' };

describe("a part's own copy of a library patch (windsor#669)", () => {
  it('has the library entry as its origin and baseline', async () => {
    const scope = await linkedScope();
    expect(patchOrigin(scope)).toEqual({ kind: 'library', id: 'kick' });
    expect(isModified(scope, patchOf(scope.ctx, 'kick-2')!)).toBe(false);
    const edited = { ...patchOf(scope.ctx, 'kick-2')!, volume: 0.1 };
    expect(isModified(scope, edited)).toBe(true);
  });

  it("saves over the library entry and this part's copy only", async () => {
    const scope = await linkedScope();
    const others = [patchOf(scope.ctx, 'kick'), patchOf(scope.ctx, 'kick-3')];
    const working = { ...patchOf(scope.ctx, 'kick-2')!, volume: 0.1 };
    expect(await savePatch({ ...scope, working, meta: META })).toBe('kick');
    expect(scope.library.entries['kick']?.patch.volume).toBe(0.1);
    expect(patchOf(scope.ctx, 'kick-2')?.volume).toBe(0.1);
    expect([patchOf(scope.ctx, 'kick'), patchOf(scope.ctx, 'kick-3')]).toEqual(others);
    expect(partAt(scope.ctx.model.doc, hat)?.preset).toBe('kick-2');
  });

  it("discards and reverts into this part's copy only", async () => {
    const scope = await linkedScope();
    const kept = patchOf(scope.ctx, 'kick');
    const entry = scope.library.entries['kick']!.patch;
    scope.ctx.change({ patches: { 'kick-2': { volume: 0.1 }, kick: { volume: 0.2 } } });
    expect(discardEdits(scope)).toEqual(entry);
    expect(patchOf(scope.ctx, 'kick-2')).toEqual(entry);
    expect(patchOf(scope.ctx, 'kick')?.volume).toBe(0.2);
    scope.ctx.change({ patches: { 'kick-2': { volume: 0.1 } } });
    revertPatch(scope.ctx, 'kick-2', scope.library, 'kick');
    expect(patchOf(scope.ctx, 'kick-2')).toEqual(entry);
    expect(patchOf(scope.ctx, 'kick')).toEqual({ ...kept, volume: 0.2 });
  });

  it('falls back to a document patch when the library entry is deleted', async () => {
    const scope = await linkedScope();
    await deletePatch(scope.library, 'kick');
    expect(patchOrigin(scope)).toEqual({ kind: 'document', id: 'kick-2' });
    expect(partAt(scope.ctx.model.doc, kick)?.preset).toBe('kick');
  });

  it('drops the link on Save as… and on Init', async () => {
    const scope = await linkedScope();
    const working = patchOf(scope.ctx, 'kick-2')!;
    const id = await copyToNew({ ...scope, working, meta: { ...META, name: 'Kick Mine' } });
    expect(partAt(scope.ctx.model.doc, hat)?.preset).toBe(id);
    expect(partAt(scope.ctx.model.doc, hat)?.patchSource).toBeUndefined();
    initPatch({ ...scope, slot: arp });
    expect(partAt(scope.ctx.model.doc, arp)?.patchSource).toBeUndefined();
  });
});
