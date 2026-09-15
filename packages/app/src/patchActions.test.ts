/**
 * The library actions (#563) over a fake folder and a real document model:
 * Init, Save, Copy to new, Delete and the unsaved-changes guard, with the
 * open song's copy following a save.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT } from '../../../packages/client/src/audio/__fixtures__/fullArrangement';
import {
  GAMEPLAY_PATCH_IDS,
  PATCH_LIBRARY,
  clonePatch,
  loadPatchFile,
  loadUnsweptPatchFile,
  makePatch,
} from '../../../packages/client/src/audio/index-for-editor';
import type {
  ArrangementDocument,
  DeepPartial,
} from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { DocumentModel } from './documentModel';
import { INIT_PATCH_NAME, INIT_PRESET_ID } from './libraryConstants';
import type { PatchFolder } from './libraryFolder';
import type { LibraryModel } from './libraryModel';
import { connectLibrary, pageLibrary } from './libraryModel';
import {
  canCopy,
  canDelete,
  canSave,
  copyPrefill,
  copyToNew,
  deletePatch,
  deleteRefusal,
  dropInit,
  initPatch,
  isModified,
  patchOrigin,
  savePatch,
  unsavedQuestion,
} from './patchActions';
import { serialisePatchFile } from '../../../packages/client/src/audio/index-for-editor';

/** An in-memory folder seeded with a few real library files. */
function fakeFolder(ids: string[]): PatchFolder & { files: Map<string, string> } {
  const files = new Map<string, string>();
  for (const id of ids) files.set(`${id}.json`, serialisePatchFile(PATCH_LIBRARY[id]!));
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

function context(): AppCtx {
  const model = new DocumentModel(FULL_ARRANGEMENT);
  const ctx = {
    model,
    change: (partial: DeepPartial<ArrangementDocument>) => {
      model.merge(partial);
      return { ok: true, ignored: [] };
    },
    restructure: (edit: (draft: Record<string, unknown>) => void) => model.mutate(edit),
    status: () => {},
  } as unknown as AppCtx;
  return ctx;
}

async function folderScope(ids = ['kick', 'hat', 'lead-bell']) {
  const folder = fakeFolder(ids);
  const library: LibraryModel = pageLibrary();
  await connectLibrary(library, folder);
  const ctx = context();
  return { ctx, library, folder, partId: 'kick' as const };
}

describe('patch origin', () => {
  it('is the library for a part on a library id, Init for the sentinel, document otherwise', async () => {
    const scope = await folderScope();
    expect(patchOrigin(scope)).toEqual({ kind: 'library', id: 'kick' });
    initPatch(scope);
    expect(patchOrigin(scope)).toEqual({ kind: 'init' });
    scope.ctx.change({ kick: { preset: 'mine' }, patches: { mine: makePatch({ name: 'mine' }) } });
    expect(patchOrigin(scope)).toEqual({ kind: 'document', id: 'mine' });
  });
});

describe('Init', () => {
  it('loads makePatch defaults named Init, not saveable, not a library entry', async () => {
    const scope = await folderScope();
    const patch = initPatch(scope);
    expect(patch).toEqual(makePatch({ name: INIT_PATCH_NAME }));
    expect(scope.ctx.model.doc.kick?.preset).toBe(INIT_PRESET_ID);
    expect(scope.ctx.model.doc.patches?.[INIT_PRESET_ID]).toEqual(patch);
    const origin = patchOrigin(scope);
    expect(canSave(origin)).toBe(false);
    expect(canCopy(origin)).toBe(true);
    expect(canDelete(origin, scope.library)).toBe(false);
    expect(Object.keys(scope.library.entries)).not.toContain(INIT_PRESET_ID);
    expect(scope.folder.files.has(`${INIT_PRESET_ID}.json`)).toBe(false);
  });

  it('is discarded when the part moves on, and Init again starts fresh', async () => {
    const scope = await folderScope();
    initPatch(scope);
    const edited = clonePatch(scope.ctx.model.doc.patches![INIT_PRESET_ID]!);
    edited.volume = 0.1;
    scope.ctx.change({ patches: { [INIT_PRESET_ID]: edited } });
    expect(initPatch(scope).volume).toBe(makePatch().volume);
    scope.ctx.change({
      kick: { preset: 'hat' },
      patches: { hat: clonePatch(PATCH_LIBRARY['hat']!.patch) },
    });
    dropInit(scope.ctx);
    expect(scope.ctx.model.doc.patches?.[INIT_PRESET_ID]).toBeUndefined();
  });
});

describe('Save', () => {
  it('writes over the library id through the loader and updates the open song copy', async () => {
    const scope = await folderScope();
    const working = clonePatch(PATCH_LIBRARY['kick']!.patch);
    working.volume = 0.5;
    // The part is playing the document's copy, as it does after the first knob edit.
    scope.ctx.change({ patches: { kick: working } });
    const id = await savePatch({
      ...scope,
      working,
      meta: { name: 'Kick Two', category: 'Drums', tags: ['kick'], description: 'Softer.' },
    });
    expect(id).toBe('kick');
    const written = JSON.parse(scope.folder.files.get('kick.json')!);
    // The record carried over is now stale — the sweep's job — but the file is otherwise valid.
    expect(() => loadPatchFile('kick', written)).toThrow('stale headroom record');
    const entry = loadUnsweptPatchFile('kick', written);
    expect(entry.name).toBe('Kick Two');
    expect(entry.patch.name).toBe('Kick Two');
    expect(entry.patch.volume).toBe(0.5);
    expect(entry.headroom).toEqual(PATCH_LIBRARY['kick']!.headroom);
    // The folder was re-read, so the library and the song both carry the save.
    expect(scope.library.entries['kick']?.patch.volume).toBe(0.5);
    expect(scope.ctx.model.doc.patches?.['kick']?.name).toBe('Kick Two');
    expect(isModified(scope, entry.patch)).toBe(false);
  });

  it('is refused for Init and for a document-only patch', async () => {
    const scope = await folderScope();
    initPatch(scope);
    const meta = { name: 'x', category: 'c', tags: [], description: '' };
    await expect(savePatch({ ...scope, working: makePatch(), meta })).rejects.toThrow(
      'Copy to new',
    );
  });

  it('downloads instead when no folder is connected, and the browser still sees the save', async () => {
    const library = pageLibrary();
    const ctx = context();
    const scope = { ctx, library, partId: 'kick' as const };
    const downloads: string[] = [];
    const working = clonePatch(PATCH_LIBRARY['kick']!.patch);
    working.volume = 0.25;
    await savePatch({
      ...scope,
      working,
      meta: { name: 'FM Kick', category: 'Drums', tags: ['kick'], description: 'd' },
      download: (id, text) => downloads.push(`${id}:${text.length}`),
    });
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.startsWith('kick:')).toBe(true);
    expect(library.entries['kick']?.patch.volume).toBe(0.25);
    expect(PATCH_LIBRARY['kick']?.patch.volume).not.toBe(0.25);
  });
});

describe('Copy to new', () => {
  it('slugs the name, suffixes a taken id, writes the file and switches the part', async () => {
    const scope = await folderScope();
    const working = clonePatch(PATCH_LIBRARY['kick']!.patch);
    const prefill = copyPrefill(scope, working);
    expect(prefill.name).toBe('FM Kick copy');
    expect(prefill.category).toBe('Drums');
    const id = await copyToNew({ ...scope, working, meta: { ...prefill, name: 'FM Kick' } });
    expect(id).toBe('fm-kick');
    const again = await copyToNew({ ...scope, working, meta: { ...prefill, name: 'FM Kick' } });
    expect(again).toBe('fm-kick-2');
    expect(scope.ctx.model.doc.kick?.preset).toBe('fm-kick-2');
    expect(scope.ctx.model.doc.patches?.['fm-kick-2']?.name).toBe('FM Kick');
    const written = JSON.parse(scope.folder.files.get('fm-kick-2.json')!);
    expect(written.headroom).toBeUndefined();
    expect(loadUnsweptPatchFile('fm-kick-2', written).name).toBe('FM Kick');
    expect(scope.library.entries['fm-kick-2']?.id).toBe('fm-kick-2');
  });

  it('from Init is named Init, and drops the sentinel once the part plays the new id', async () => {
    const scope = await folderScope();
    const working = initPatch(scope);
    expect(copyPrefill(scope, working).name).toBe(INIT_PATCH_NAME);
    const id = await copyToNew({
      ...scope,
      working,
      meta: { name: 'Init', category: 'Leads', tags: [], description: '' },
    });
    expect(id).toBe('init');
    expect(scope.ctx.model.doc.kick?.preset).toBe('init');
    expect(scope.ctx.model.doc.patches?.[INIT_PRESET_ID]).toBeUndefined();
  });
});

describe('Delete', () => {
  it('is refused for every gameplay id and allowed otherwise', async () => {
    const scope = await folderScope(['kick', 'weapon-zap', 'pickup-blip']);
    for (const id of Object.values(GAMEPLAY_PATCH_IDS)) {
      expect(deleteRefusal(id)).toContain('GAMEPLAY_PATCH_IDS');
      await expect(deletePatch(scope.library, id)).rejects.toThrow('cannot be deleted');
      expect(scope.folder.files.has(`${id}.json`)).toBe(true);
    }
    expect(deleteRefusal('kick')).toBeNull();
    await deletePatch(scope.library, 'kick');
    expect(scope.folder.files.has('kick.json')).toBe(false);
    expect(scope.library.entries['kick']).toBeUndefined();
    // The song keeps what it carries.
    expect(scope.ctx.model.doc.kick?.preset).toBe('kick');
  });

  it('needs the folder', async () => {
    await expect(deletePatch(pageLibrary(), 'kick')).rejects.toThrow('folder');
  });
});

describe('the unsaved-changes guard', () => {
  it('asks only when the working patch differs from its library entry or Init', async () => {
    const scope = await folderScope();
    const pristine = clonePatch(PATCH_LIBRARY['kick']!.patch);
    expect(unsavedQuestion(scope, pristine)).toBeNull();
    const edited = clonePatch(pristine);
    edited.ops[0]!.level = 0.5;
    expect(unsavedQuestion(scope, edited)).toContain('"FM Kick"');
    const init = initPatch(scope);
    expect(unsavedQuestion(scope, init)).toBeNull();
    init.volume = 0.3;
    expect(unsavedQuestion(scope, init)).toContain('Init');
  });
});
