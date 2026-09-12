import { describe, expect, it } from 'vitest';
import { choosePreset } from './presetBrowser';
import { DocumentModel } from './documentModel';
import type { AppCtx } from './context';
import { FULL_ARRANGEMENT } from '../../../packages/client/src/audio/__fixtures__/fullArrangement';
import { PRESETS, clonePatch } from '../../../packages/client/src/audio/index-for-editor';

function context(): AppCtx {
  const model = new DocumentModel(FULL_ARRANGEMENT);
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
    expect(choosePreset(ctx, 'arp', id)).toBe(true);
    expect(ctx.model.doc.arp?.preset).toBe(id);
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
    expect(choosePreset(ctx, 'drone', id)).toBe(true);
    expect(ctx.model.doc.patches?.[id]).toEqual(patch);
    expect(PRESETS[id]?.volume).not.toBe(patch.volume);
  });
  it('rejects missing patches without touching the document', () => {
    const ctx = context();
    const before = ctx.model.toJson();
    expect(choosePreset(ctx, 'arp', 'not-a-patch')).toBe(false);
    expect(choosePreset(ctx, 'arp', 'constructor')).toBe(false);
    expect(ctx.model.toJson()).toBe(before);
  });
});
