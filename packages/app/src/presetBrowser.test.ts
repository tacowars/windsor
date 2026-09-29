import { beforeAll, describe, expect, it } from 'vitest';
import { choosePreset, pickPreset } from './presetBrowser';
import { openGestureConsole } from './__fixtures__/gestureConsole';
import { dropInit } from './patchActions';
import { DocumentModel } from './documentModel';
import type { AppCtx } from './context';
import { FULL_ARRANGEMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import { clonePatch, partAt } from '@windsor/engine';
import { PRESETS } from '@windsor/engine/patch/presets';
import { library, loadPageLibrary } from './libraryModel';

// The built-in library loads on demand in the page; these tests read it
// through the console's shared model, as the page does after boot.
beforeAll(() => loadPageLibrary(library));

function context(): AppCtx {
  const model = new DocumentModel({ version: 3, ...FULL_ARRANGEMENT });
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
