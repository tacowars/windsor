import { beforeAll, describe, expect, it } from 'vitest';
import { choosePreset, pickPreset } from './presetBrowser';
import { openGestureConsole } from './__fixtures__/gestureConsole';
import { dropInit } from './patchActions';
import { DocumentModel } from './documentModel';
import type { AppCtx } from './context';
import { FULL_ARRANGEMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import { ARRANGEMENT_VERSION, clonePatch, makePatch, partAt } from '@windsor/engine';
import { PRESETS } from '@windsor/engine/patch/presets';
import { library, loadPageLibrary } from './libraryModel';
import { addPart, newSong } from './songParts';

// The built-in library loads on demand in the page; these tests read it
// through the console's shared model, as the page does after boot.
beforeAll(() => loadPageLibrary(library));

function context(): AppCtx {
  const model = new DocumentModel({ version: ARRANGEMENT_VERSION, ...FULL_ARRANGEMENT });
  return {
    model,
    change: (partial) => {
      model.merge(partial);
      return { ok: true };
    },
  } as AppCtx;
}
describe('browser selection', () => {
  it('copies a selected factory patch into the song before any knob edit', () => {
    const ctx = context();
    const id = 'score-concrete-chord';
    const original = PRESETS[id]!;
    expect(choosePreset(ctx, FULL_SLOT.arp, id)).toBe(true);
    expect(partAt(ctx.model.doc, FULL_SLOT.arp)?.preset).toBe(id);
    expect(ctx.model.doc.patches?.[id]).toEqual(original);
    const imported = new DocumentModel(JSON.parse(ctx.model.toJson()));
    expect(imported.doc.patches?.[id]).toEqual(original);
    expect(ctx.model.doc.patches?.[id]).not.toBe(original);
  });
  it('preserves a document override when reselected', () => {
    const ctx = context();
    const id = 'score-harbour-fog';
    const patch = clonePatch(PRESETS[id]!);
    patch.volume *= 0.5;
    ctx.model.merge({ patches: { [id]: patch } });
    expect(choosePreset(ctx, FULL_SLOT.drone, id)).toBe(true);
    expect(ctx.model.doc.patches?.[id]).toEqual(patch);
    expect(PRESETS[id]?.volume).not.toBe(patch.volume);
  });
  it('rejects missing patches without touching the document', () => {
    const ctx = context();
    const before = ctx.model.toJson();
    expect(choosePreset(ctx, FULL_SLOT.arp, 'not-a-patch')).toBe(false);
    expect(choosePreset(ctx, FULL_SLOT.arp, 'constructor')).toBe(false);
    expect(ctx.model.toJson()).toBe(before);
  });
});

describe('choosing a preset as an undo step (windsor#130)', () => {
  it('is one step, the Init discard it sets off included', () => {
    const ctx = openGestureConsole();
    const before = ctx.model.doc;
    const init = partAt(before, 0)?.preset ?? '';
    const id = 'score-concrete-chord';
    expect(pickPreset(ctx, 0, id, () => dropInit(ctx))).toBe(true);
    // Two edits: the part switched to the preset, and the Init no part plays dropped.
    expect(partAt(ctx.model.doc, 0)?.preset).toBe(id);
    expect(ctx.model.doc.patches?.[init]).toBeUndefined();
    expect(ctx.undoLabel).toBe('Choose preset');
    expect(ctx.undo()).toBe(true);
    expect(ctx.model.doc).toEqual(before);
    expect(ctx.canUndo).toBe(false);
  });

  it('records nothing for a preset that does not load', () => {
    const ctx = openGestureConsole();
    expect(pickPreset(ctx, 0, 'not-a-patch', () => dropInit(ctx))).toBe(false);
    expect(ctx.canUndo).toBe(false);
  });
});

describe('each part owns its patch (windsor#669)', () => {
  const ID = 'score-concrete-chord';

  /** A console over a new song with Init parts on slots 0, 1 and 2. */
  function threeParts() {
    const first = new DocumentModel(newSong());
    const second = new DocumentModel(addPart(first.doc)!.doc);
    return openGestureConsole(addPart(second.doc)!.doc);
  }

  it('copies a song patch another part plays, so a knob edit on either moves only its own', () => {
    const ctx = threeParts();
    ctx.change({ patches: { 'my-pad': makePatch({ name: 'My Pad', volume: 0.4 }) } });
    expect(choosePreset(ctx, 0, 'my-pad')).toBe(true);
    expect(choosePreset(ctx, 1, 'my-pad')).toBe(true);
    const doc = ctx.model.doc;
    expect(partAt(doc, 1)?.preset).toBe('my-pad-2');
    expect(partAt(doc, 1)?.patchSource).toBeUndefined();
    expect(doc.patches?.['my-pad-2']).toEqual(doc.patches?.['my-pad']);
    ctx.change({ patches: { 'my-pad-2': { volume: 0.9 } } });
    expect(ctx.model.doc.patches?.['my-pad']?.volume).toBe(0.4);
    ctx.change({ patches: { 'my-pad': { volume: 0.1 } } });
    expect(ctx.model.doc.patches?.['my-pad-2']?.volume).toBe(0.9);
  });

  it('loads a library patch no other part plays under its own id, with no patchSource', () => {
    const ctx = threeParts();
    expect(choosePreset(ctx, 0, ID)).toBe(true);
    expect(partAt(ctx.model.doc, 0)?.preset).toBe(ID);
    expect(partAt(ctx.model.doc, 0)?.patchSource).toBeUndefined();
  });

  it('gives three parts picking one library patch three ids, the copies linked to it', () => {
    const ctx = threeParts();
    for (const slot of [0, 1, 2]) expect(choosePreset(ctx, slot, ID)).toBe(true);
    const parts = ctx.model.doc.parts.map((part) => [part.preset, part.patchSource]);
    expect(parts).toEqual([
      [ID, undefined],
      [`${ID}-2`, ID],
      [`${ID}-3`, ID],
    ]);
  });

  it("keeps a copy's link on a re-pick, and drops it on any other pick", () => {
    const ctx = threeParts();
    choosePreset(ctx, 0, ID);
    choosePreset(ctx, 1, ID);
    expect(choosePreset(ctx, 1, `${ID}-2`)).toBe(true);
    expect(partAt(ctx.model.doc, 1)?.patchSource).toBe(ID);
    expect(choosePreset(ctx, 1, 'score-amber-stab')).toBe(true);
    expect(partAt(ctx.model.doc, 1)?.preset).toBe('score-amber-stab');
    expect(partAt(ctx.model.doc, 1)?.patchSource).toBeUndefined();
  });

  it('undoes a load that made a copy in one step, and redoes it', () => {
    const ctx = threeParts();
    pickPreset(ctx, 0, ID, () => dropInit(ctx));
    const before = ctx.model.doc;
    expect(pickPreset(ctx, 1, ID, () => dropInit(ctx))).toBe(true);
    const after = ctx.model.doc;
    expect(partAt(after, 1)?.preset).toBe(`${ID}-2`);
    expect(ctx.undo()).toBe(true);
    expect(ctx.model.doc).toEqual(before);
    expect(ctx.model.doc.patches?.[`${ID}-2`]).toBeUndefined();
    expect(ctx.redo()).toBe(true);
    expect(ctx.model.doc).toEqual(after);
  });
});
