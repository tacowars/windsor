/**
 * The keyboard fold's edit (windsor#918, record `2026-10-18-keyboard-fold`
 * decision 1): one field on one part, kept by the document, reaching the
 * live arrangement, and round-tripping through export and import.
 */
import { describe, expect, it } from 'vitest';

import type { ArrangementPartial } from '@windsor/engine';
import { makeArrangement, mergeArrangement, partAt } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import { partFoldChange } from './keyboardFoldEdits';
import { newSong } from './songParts';

describe('a part’s keyboard fold', () => {
  it('is off on a new song, and one field on the part once set', () => {
    const model = new DocumentModel(newSong());
    expect(partAt(model.doc, 0)?.fold).toBe('off');
    const partial = partFoldChange(model.doc, 0, 'chord');
    expect(partial).toEqual({ parts: { 0: { fold: 'chord' } } });
    if (partial) model.merge(partial);
    expect(partAt(model.doc, 0)?.fold).toBe('chord');
  });

  it('is nothing when unchanged or when the part is gone', () => {
    const model = new DocumentModel(newSong());
    expect(partFoldChange(model.doc, 0, 'off')).toBeNull();
    expect(partFoldChange(model.doc, 9, 'scale')).toBeNull();
  });

  it('reaches the live arrangement: the engine merge names it a field', () => {
    const model = new DocumentModel(newSong());
    const partial = partFoldChange(model.doc, 0, 'scale');
    const { merged, ignored } = mergeArrangement(model.doc, partial as ArrangementPartial);
    expect(ignored).toEqual([]);
    expect(merged.parts[0]?.fold).toBe('scale');
  });

  it.each(['scale', 'chord'] as const)('round-trips %s through export and import', (fold) => {
    const model = new DocumentModel(newSong());
    const partial = partFoldChange(model.doc, 0, fold);
    if (partial) model.merge(partial);
    const again = makeArrangement(JSON.parse(JSON.stringify(model.doc)));
    expect(again.corrections).toEqual([]);
    expect(partAt(again.document, 0)?.fold).toBe(fold);
  });
});
