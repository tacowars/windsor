/**
 * `selectPart` (windsor#462 decision 2): a pick from any tab reloads the
 * working patch, so the next knob edit writes into the picked part's preset
 * and never carries the last part's patch over it.
 */
import { describe, expect, it } from 'vitest';
import type { AudioPart } from '@windsor/engine';
import { makePatch, partAt } from '@windsor/engine';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { DocumentModel } from './documentModel';
import type { EngineHost } from './host';
import { addPartLive } from './partEdits';
import { selectPart } from './partsSession';
import { newSong } from './songParts';

function openContext(): AppContext<TabPanel> {
  const host: ContextHost = {
    apply: () => ({ ok: true, ignored: [] }),
    build: () => Promise.resolve(),
    isBuilding: false,
    capturePattern: () => null,
    part: (): AudioPart | null => null,
  };
  return new AppContext<TabPanel>({
    host: host as EngineHost,
    model: new DocumentModel(newSong()),
    notify: () => undefined,
  });
}

describe('selectPart', () => {
  it('reloads the working patch, so a knob edit after a pick lands on the picked part only', () => {
    const ctx = openContext();
    expect(addPartLive(ctx)).toBe(1);
    const preset = (slot: number): string => partAt(ctx.model.doc, slot)?.preset ?? '';
    ctx.change({ patches: { [preset(1)]: makePatch({ name: 'one' }) } });
    selectPart(ctx, 0);
    ctx.parts.patch = makePatch({ name: 'zero, edited' });
    ctx.parts.push();
    const picks = ctx.parts.picks;

    selectPart(ctx, 1);
    expect(ctx.parts.picks).toBe(picks + 1);
    expect(ctx.parts.patch.name).toBe('one');
    ctx.parts.patch.name = 'one, edited';
    ctx.parts.push();
    expect(ctx.model.doc.patches?.[preset(1)]?.name).toBe('one, edited');
    expect(ctx.model.doc.patches?.[preset(0)]?.name).toBe('zero, edited');
  });

  it('counts a pick only when the selection moves', () => {
    const ctx = openContext();
    const picks = ctx.parts.picks;
    selectPart(ctx, ctx.parts.selected);
    expect(ctx.parts.picks).toBe(picks);
  });
});
