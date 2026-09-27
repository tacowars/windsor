/**
 * The library actions (#563) over a fake folder and a real document model:
 * Init, Save, Copy to new, Delete and the unsaved-changes guard, with the
 * open song's copy following a save.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import {
  GAMEPLAY_PATCH_IDS,
  PATCH_LIBRARY,
  clonePatch,
  loadPatchFile,
  loadUnsweptPatchFile,
  makePatch,
  partAt,
} from '@windsor/engine';
import type { DocumentPartial } from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
import { DocumentModel } from './documentModel';
import { INIT_PATCH_NAME, initPresetId } from './libraryConstants';
import { listLibrary } from './libraryModel';
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
  discardEdits,
  dropInit,
  initPatch,
  isModified,
  patchOrigin,
  savePatch,
  unsavedQuestion,
} from './patchActions';
import { revertPatch } from './patchLibrary';
import { serialisePatchFile } from '@windsor/engine';

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
  const model = new DocumentModel({ version: 3, ...FULL_ARRANGEMENT });
  const ctx = {
    model,
    change: (partial: DocumentPartial) => {
      model.merge(partial);
      return { ok: true, ignored: [] };
    },
    restructure: (edit: (draft: Record<string, unknown>) => void) => model.mutate(edit),
    render: () => {},
    status: () => {},
  } as unknown as AppCtx;
  return ctx;
}

async function folderScope(ids = ['kick', 'hat', 'lead-bell']) {
  const folder = fakeFolder(ids);
  const library: LibraryModel = pageLibrary();
  await connectLibrary(library, folder);
  const ctx = context();
  return { ctx, library, folder, slot: FULL_SLOT.kick };
}

describe('patch origin', () => {
  it('is the library for a part on a library id, Init for the sentinel, document otherwise', async () => {
    const scope = await folderScope();
    expect(patchOrigin(scope)).toEqual({ kind: 'library', id: 'kick' });
    initPatch(scope);
    expect(patchOrigin(scope)).toEqual({ kind: 'init' });
    scope.ctx.change({
      ...partChange(FULL_SLOT.kick, { preset: 'mine' }),
      patches: { mine: makePatch({ name: 'mine' }) },
    });
    expect(patchOrigin(scope)).toEqual({ kind: 'document', id: 'mine' });
  });
});

const INIT_ID = initPresetId(String(FULL_SLOT.kick));

describe('Init', () => {
  it('loads makePatch defaults named Init, not saveable, not a library entry', async () => {
    const scope = await folderScope();
    const patch = initPatch(scope);
    expect(patch).toEqual(makePatch({ name: INIT_PATCH_NAME }));
    expect(partAt(scope.ctx.model.doc, FULL_SLOT.kick)?.preset).toBe(INIT_ID);
    expect(scope.ctx.model.doc.patches?.[INIT_ID]).toEqual(patch);
    const origin = patchOrigin(scope);
    expect(canSave(origin)).toBe(false);
    expect(canCopy(origin)).toBe(true);
    expect(canDelete(origin, scope.library)).toBe(false);
    expect(Object.keys(scope.library.entries)).not.toContain(INIT_ID);
    expect(scope.folder.files.has(`${INIT_ID}.json`)).toBe(false);
  });

  it("is one sentinel per part, so a second part's Init leaves the first alone", async () => {
    const scope = await folderScope();
    const kickInit = initPatch(scope);
    kickInit.volume = 0.1;
    scope.ctx.change({ patches: { [INIT_ID]: kickInit } });
    initPatch({ ...scope, slot: FULL_SLOT.hat });
    expect(partAt(scope.ctx.model.doc, FULL_SLOT.hat)?.preset).toBe(
      initPresetId(String(FULL_SLOT.hat)),
    );
    expect(scope.ctx.model.doc.patches?.[INIT_ID]?.volume).toBe(0.1);
    // Neither sentinel is offered as a patch to load.
    const listed = listLibrary(scope.library.entries, scope.ctx.model.doc.patches).map((e) => e.id);
    expect(listed).not.toContain(INIT_ID);
    expect(listed).not.toContain(initPresetId(String(FULL_SLOT.hat)));
    // Dropping clears only the sentinels no part plays.
    scope.ctx.change({ ...partChange(FULL_SLOT.kick, { preset: 'kick' }) });
    dropInit(scope.ctx);
    expect(scope.ctx.model.doc.patches?.[INIT_ID]).toBeUndefined();
    expect(scope.ctx.model.doc.patches?.[initPresetId(String(FULL_SLOT.hat))]).toBeDefined();
  });

  it('is discarded when the part moves on, and Init again starts fresh', async () => {
    const scope = await folderScope();
    initPatch(scope);
    const edited = clonePatch(scope.ctx.model.doc.patches![INIT_ID]!);
    edited.volume = 0.1;
    scope.ctx.change({ patches: { [INIT_ID]: edited } });
    expect(initPatch(scope).volume).toBe(makePatch().volume);
    scope.ctx.change({
      ...partChange(FULL_SLOT.kick, { preset: 'hat' }),
      patches: { hat: clonePatch(PATCH_LIBRARY['hat']!.patch) },
    });
    dropInit(scope.ctx);
    expect(scope.ctx.model.doc.patches?.[INIT_ID]).toBeUndefined();
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
    const scope = { ctx, library, slot: FULL_SLOT.kick };
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
    expect(partAt(scope.ctx.model.doc, FULL_SLOT.kick)?.preset).toBe('fm-kick-2');
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
    expect(partAt(scope.ctx.model.doc, FULL_SLOT.kick)?.preset).toBe('init');
    expect(scope.ctx.model.doc.patches?.[INIT_ID]).toBeUndefined();
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
    expect(partAt(scope.ctx.model.doc, FULL_SLOT.kick)?.preset).toBe('kick');
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

  it('really discards on confirm: the document copy goes back to the library entry, or to Init', async () => {
    const scope = await folderScope();
    const edited = clonePatch(PATCH_LIBRARY['kick']!.patch);
    edited.volume = 0.5;
    scope.ctx.change({ patches: { kick: edited } });
    const restored = discardEdits(scope);
    expect(restored).toEqual(PATCH_LIBRARY['kick']!.patch);
    expect(scope.ctx.model.doc.patches?.['kick']?.volume).toBe(PATCH_LIBRARY['kick']!.patch.volume);
    expect(isModified(scope, scope.ctx.model.doc.patches!['kick']!)).toBe(false);
    const init = initPatch(scope);
    init.volume = 0.3;
    scope.ctx.change({ patches: { [INIT_ID]: init } });
    expect(discardEdits(scope)).toEqual(makePatch({ name: INIT_PATCH_NAME }));
    expect(scope.ctx.model.doc.patches?.[INIT_ID]?.volume).toBe(makePatch().volume);
    // A document-only patch has no baseline to restore.
    scope.ctx.change({
      ...partChange(FULL_SLOT.kick, { preset: 'mine' }),
      patches: { mine: makePatch({ name: 'mine' }) },
    });
    expect(discardEdits(scope)).toBeNull();
  });
});

describe('Revert to library', () => {
  it("resets a folder-only id to the library file instead of dropping the part's only copy", async () => {
    const scope = await folderScope();
    const working = clonePatch(PATCH_LIBRARY['kick']!.patch);
    const id = await copyToNew({
      ...scope,
      working,
      meta: { name: 'Folder Only', category: 'Drums', tags: [], description: '' },
    });
    const edited = clonePatch(scope.ctx.model.doc.patches![id]!);
    edited.volume = 0.2;
    scope.ctx.change({ patches: { [id]: edited } });
    revertPatch(scope.ctx, id, scope.library);
    expect(partAt(scope.ctx.model.doc, FULL_SLOT.kick)?.preset).toBe(id);
    expect(scope.ctx.model.doc.patches?.[id]?.volume).toBe(working.volume);
    expect(scope.ctx.model.dangling).toEqual([]);
  });
});
