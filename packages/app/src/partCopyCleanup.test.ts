/**
 * A part's unedited automatic copy goes when the part moves on (windsor#671),
 * over a real `AppContext` and the page library: the step, the knob edit and
 * the rename that keep it, undo, Init and Save as…, and the rename that keeps
 * a copy's library link (decision 5).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { makePatch, partAt } from '@windsor/engine';
import { openGestureConsole } from './__fixtures__/gestureConsole';
import { DocumentModel } from './documentModel';
import type { PatchFolder } from './libraryFolder';
import { connectUserLibrary, library, loadPageLibrary, pageLibrary } from './libraryModel';
import { leftCopyDrop } from './partCopyCleanup';
import { copyToNew, dropInit, initPatch, isModified, patchOrigin } from './patchActions';
import { renamePatch } from './patchLibrary';
import { choosePreset, pickPreset } from './presetBrowser';
import { addPart, newSong } from './songParts';

beforeAll(() => loadPageLibrary(library));

const ICE = 'score-ice-needle';
const COPY = `${ICE}-2`;
const STEPS = [
  'score-concrete-chord',
  'score-amber-stab',
  'score-harbour-fog',
  'score-ash-cathedral',
  'score-copper-step',
];

/** A console over a new song with Init parts on slots 0 and 1; part 0 plays `ICE`. */
function twoParts() {
  const first = new DocumentModel(newSong());
  const ctx = openGestureConsole(addPart(first.doc)!.doc);
  pickPreset(ctx, 0, ICE, () => dropInit(ctx));
  return ctx;
}

/** Part 1 steps onto `ICE` and gets its copy. */
function onCopy() {
  const ctx = twoParts();
  pickPreset(ctx, 1, ICE, () => dropInit(ctx));
  expect(partAt(ctx.model.doc, 1)).toMatchObject({ preset: COPY, patchSource: ICE });
  return ctx;
}

const step = (ctx: ReturnType<typeof twoParts>, id: string) =>
  pickPreset(ctx, 1, id, () => dropInit(ctx));

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

describe('dropping an unedited automatic copy (windsor#671)', () => {
  it('drops the copy a part steps off, and undo brings it back with the part', () => {
    const ctx = onCopy();
    const before = ctx.model.doc;
    expect(step(ctx, STEPS[0]!)).toBe(true);
    expect(ctx.model.doc.patches?.[COPY]).toBeUndefined();
    expect(ctx.undo()).toBe(true);
    expect(ctx.model.doc).toEqual(before);
    expect(partAt(ctx.model.doc, 1)?.preset).toBe(COPY);
  });

  it('keeps a copy holding a knob edit, or renamed', () => {
    const edited = onCopy();
    edited.change({ patches: { [COPY]: { volume: 0.123 } } });
    step(edited, STEPS[0]!);
    expect(edited.model.doc.patches?.[COPY]?.volume).toBe(0.123);
    const renamed = onCopy();
    renamePatch(renamed, COPY, 'my-needle');
    step(renamed, STEPS[0]!);
    expect(renamed.model.doc.patches?.['my-needle']).toBeDefined();
  });

  it('leaves at most the copy the part plays after stepping past a shared patch', () => {
    const ctx = twoParts();
    const count = Object.keys(ctx.model.doc.patches ?? {}).length;
    for (const id of [...STEPS, ICE, ...STEPS, ICE, STEPS[0]!]) expect(step(ctx, id)).toBe(true);
    const ids = Object.keys(ctx.model.doc.patches ?? {});
    expect(ids.filter((id) => id.startsWith(`${ICE}-`))).toEqual([]);
    expect(ids.length).toBeLessThanOrEqual(count + STEPS.length);
  });

  it('keeps the unplayed copies a song opened with; only a part leaving one drops it', () => {
    const ctx = twoParts();
    const orphan = { ...ctx.model.doc.patches![ICE]! };
    ctx.change({ patches: { [`${ICE}-5`]: orphan } });
    step(ctx, STEPS[0]!);
    step(ctx, STEPS[1]!);
    expect(ctx.model.doc.patches?.[`${ICE}-5`]).toEqual(orphan);
  });

  it('drops the copy a part leaves for Init', () => {
    const ctx = onCopy();
    initPatch({ ctx, library, slot: 1 });
    expect(ctx.model.doc.patches?.[COPY]).toBeUndefined();
  });

  it('drops a copy of a song-only patch, whose base is still in the song', () => {
    const ctx = twoParts();
    ctx.change({ patches: { 'my-pad': makePatch({ name: 'My Pad', volume: 0.4 }) } });
    choosePreset(ctx, 0, 'my-pad');
    choosePreset(ctx, 1, 'my-pad');
    expect(partAt(ctx.model.doc, 1)?.preset).toBe('my-pad-2');
    choosePreset(ctx, 1, STEPS[0]!);
    expect(ctx.model.doc.patches?.['my-pad-2']).toBeUndefined();
  });

  it('never drops a library id, a patch another part plays, or a part staying put', () => {
    const ctx = onCopy();
    const doc = ctx.model.doc;
    expect(leftCopyDrop(doc, 0, STEPS[0]!, library)).toBeNull();
    expect(leftCopyDrop(doc, 1, COPY, library)).toBeNull();
    expect(leftCopyDrop(doc, 1, STEPS[0]!, library)).toEqual({ [COPY]: null });
  });
});

describe('Save as… from an automatic copy (windsor#671)', () => {
  async function saveAs(edit: boolean) {
    const userLibrary = pageLibrary();
    await connectUserLibrary(userLibrary, emptyStore());
    const ctx = onCopy();
    if (edit) ctx.change({ patches: { [COPY]: { volume: 0.123 } } });
    const working = ctx.model.doc.patches![COPY]!;
    const meta = { name: 'Needle Mine', category: '', tags: [], description: '' };
    const id = await copyToNew({ ctx, library: userLibrary, slot: 1, working, meta });
    expect(partAt(ctx.model.doc, 1)?.preset).toBe(id);
    return ctx.model.doc.patches?.[COPY];
  }

  it('drops the copy when no edit was made', async () => {
    expect(await saveAs(false)).toBeUndefined();
  });

  it('keeps the copy that holds the edit', async () => {
    expect((await saveAs(true))?.volume).toBe(0.123);
  });
});

describe('a rename keeps the library link (windsor#671 decision 5)', () => {
  /** Part 1 plays `ICE`'s song copy under the library id itself. */
  function onLibraryId() {
    const first = new DocumentModel(newSong());
    const ctx = openGestureConsole(addPart(first.doc)!.doc);
    pickPreset(ctx, 1, ICE, () => dropInit(ctx));
    return ctx;
  }

  it('links a copy renamed off a library id to that id, for Save and the marker', () => {
    const ctx = onLibraryId();
    renamePatch(ctx, ICE, 'ice-bright', 'Ice Bright');
    expect(partAt(ctx.model.doc, 1)).toMatchObject({ preset: 'ice-bright', patchSource: ICE });
    const scope = { ctx, library, slot: 1 };
    expect(patchOrigin(scope)).toEqual({ kind: 'library', id: ICE });
    expect(isModified(scope, ctx.model.doc.patches!['ice-bright']!)).toBe(true);
  });

  it("keeps a part's existing link, and sets none off a song-only id", () => {
    const ctx = onCopy();
    renamePatch(ctx, COPY, 'my-needle');
    expect(partAt(ctx.model.doc, 1)?.patchSource).toBe(ICE);
    ctx.change({ patches: { 'my-pad': makePatch({ name: 'My Pad' }) } });
    choosePreset(ctx, 0, 'my-pad');
    renamePatch(ctx, 'my-pad', 'my-pad-bright');
    expect(partAt(ctx.model.doc, 0)?.patchSource).toBeUndefined();
  });
});
