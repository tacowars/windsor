/**
 * The patch box's RACK tag (windsor#885, record `2026-10-17-racks` decision
 * 19) over the rack test scope: none without a rack, none for a rack the
 * library no longer holds, unlit right after a load, lit after an insert
 * edit, and quiet on a rename (decision 14 as amended).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { partAt } from '@windsor/engine';
import { FULL_DOCUMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import { rackTestScope, raw } from './__fixtures__/rackScope';
import { loadBuiltIns } from './builtInLibrary';
import { rackTag } from './rackBarModel';

beforeAll(() => loadBuiltIns());

const { arp, song, scope } = rackTestScope(FULL_DOCUMENT, FULL_SLOT);

describe('rackTag', () => {
  it('is null without a rackSource, and for a rack the library does not hold', () => {
    const model = song();
    const { rack, load } = scope(model);
    expect(rackTag(partAt(model.doc, arp), undefined, {})).toBeNull();
    const ref = rack();
    load(arp, ref);
    const part = partAt(model.doc, arp)!;
    expect(part.rackSource).toBe('kick-rack');
    expect(rackTag(part, model.doc.patches?.[part.preset], {})).toBeNull();
  });

  it('names the rack, unlit after a load and after a rename, lit after an insert edit', () => {
    const model = song();
    const { rack, load } = scope(model);
    const ref = rack();
    load(arp, ref);
    const racks = { 'kick-rack': { ...ref.file, id: 'kick-rack', problems: [] } };
    const tag = () => rackTag(partAt(model.doc, arp), model.doc.patches?.['kick-rack'], racks);
    expect(tag()).toEqual({ id: 'kick-rack', name: 'Kick Rack', modified: false });
    const copy = model.doc.patches!['kick-rack']!;
    model.merge(raw({ patches: { 'kick-rack': { ...copy, name: 'Other' } } }));
    expect(tag()?.modified).toBe(false);
    model.merge(raw({ parts: { [arp]: { strip: { inserts: [] } } } }));
    expect(tag()?.modified).toBe(true);
  });
});
