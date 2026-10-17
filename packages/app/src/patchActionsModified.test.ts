/**
 * The patch's modified dot and the name (record `2026-10-17-racks`
 * decision 14 as amended, windsor#884): a renamed copy is unmodified, and
 * every other leaf still counts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FULL_ARRANGEMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import { ARRANGEMENT_VERSION, serialisePatchFile } from '@windsor/engine';
import type { DocumentPartial } from '@windsor/engine';
import { PATCH_LIBRARY } from '@windsor/engine/patch/presets';
import { AutoCopies } from './autoCopies';
import { loadBuiltIns } from './builtInLibrary';
import type { AppCtx } from './context';
import { DocumentModel } from './documentModel';
import type { PatchFolder } from './libraryFolder';
import type { LibraryModel } from './libraryModel';
import { connectLibrary, pageLibrary } from './libraryModel';
import { isModified } from './patchActions';

beforeAll(() => loadBuiltIns());

function fakeFolder(ids: string[]): PatchFolder {
  const files = new Map(ids.map((id) => [`${id}.json`, serialisePatchFile(PATCH_LIBRARY[id]!)]));
  return {
    name: 'patches',
    list: () => Promise.resolve([...files.keys()]),
    read: (name) => Promise.resolve(files.get(name) ?? ''),
    write: (name, text) => Promise.resolve(void files.set(name, text)),
    remove: (name) => Promise.resolve(void files.delete(name)),
  };
}

async function folderScope() {
  const library: LibraryModel = pageLibrary();
  await connectLibrary(library, fakeFolder(['kick', 'hat']));
  const model = new DocumentModel({ version: ARRANGEMENT_VERSION, ...FULL_ARRANGEMENT });
  const ctx = {
    model,
    autoCopies: new AutoCopies(),
    change: (partial: DocumentPartial) => {
      model.merge(partial);
      return { ok: true, ignored: [] };
    },
    render: () => {},
    notify: () => {},
  } as unknown as AppCtx;
  return { ctx, library, slot: FULL_SLOT.kick };
}
describe('the modified dot and the name (record 2026-10-17-racks decision 14, windsor#884)', () => {
  it('ignores the name and reads every other leaf', async () => {
    const scope = await folderScope();
    const entry = scope.library.entries['kick']!;
    expect(isModified(scope, { ...entry.patch, name: 'Renamed Kick' })).toBe(false);
    expect(isModified(scope, { ...entry.patch, volume: entry.patch.volume * 0.5 })).toBe(true);
  });
});
