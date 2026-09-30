/**
 * The Song pane's insert panel (windsor#156): its header's count, and the
 * context its chain edits through — an edit that takes marks the Mixer tab
 * stale and tells the panel; a refused one does neither.
 */
import { describe, expect, it } from 'vitest';

import type { ApplyResult, DocumentPartial } from '@windsor/engine';
import type { AppCtx } from './context';
import { insertCountLabel, songPaneCtx } from './songInsertModel';

function fakeCtx(ok: boolean): { ctx: AppCtx; calls: string[] } {
  const calls: string[] = [];
  const ctx = {
    model: { doc: 'the document' },
    change: (partial: DocumentPartial): ApplyResult => {
      calls.push(`change ${JSON.stringify(partial)}`);
      return { ok } as ApplyResult;
    },
    invalidate: () => calls.push('invalidate'),
    render: () => calls.push('render'),
    refreshTabs: () => calls.push('refreshTabs'),
    notify: (message: string) => calls.push(`notify ${message}`),
  } as unknown as AppCtx;
  return { ctx, calls };
}

describe('the Song pane insert panel', () => {
  it('counts the chain in its header', () => {
    expect(insertCountLabel(0)).toBe('No inserts');
    expect(insertCountLabel(1)).toBe('1 insert');
    expect(insertCountLabel(2)).toBe('2 inserts');
  });

  it('marks the other tabs stale and reports an edit that takes', () => {
    const { ctx, calls } = fakeCtx(true);
    let edited = 0;
    const pane = songPaneCtx(ctx, () => edited++);
    expect(pane.change({ master: { inserts: [] } }).ok).toBe(true);
    expect(calls).toEqual(['change {"master":{"inserts":[]}}', 'invalidate']);
    expect(edited).toBe(1);
  });

  it('leaves the tabs and the panel alone when the edit is refused', () => {
    const { ctx, calls } = fakeCtx(false);
    let edited = 0;
    const pane = songPaneCtx(ctx, () => edited++);
    expect(pane.change({ master: { inserts: [] } }).ok).toBe(false);
    expect(calls).toEqual(['change {"master":{"inserts":[]}}']);
    expect(edited).toBe(0);
  });

  it('passes everything else through to the context, read at each call', () => {
    const { ctx, calls } = fakeCtx(true);
    const pane = songPaneCtx(ctx, () => undefined);
    expect(pane.model).toBe(ctx.model);
    pane.render();
    pane.refreshTabs();
    pane.notify('hello');
    expect(calls).toEqual(['render', 'refreshTabs', 'notify hello']);
  });
});
