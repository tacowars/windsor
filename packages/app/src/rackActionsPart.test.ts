/**
 * The pure rack rules (windsor#868, record `2026-10-17-racks` decisions 12
 * and 14) over the full fixture: a part added from a rack, and the
 * member-by-member difference the rack's modified dot reads.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { partAt } from '@windsor/engine';
import { FULL_DOCUMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import { addPartFromRackChange, rackDifferences } from './rackActions';
import { ALL, BARE, rackTestScope, raw } from './__fixtures__/rackScope';
import { loadBuiltIns } from './builtInLibrary';
import { addPart } from './songParts';

beforeAll(() => loadBuiltIns());

const { arp, song, scope } = rackTestScope(FULL_DOCUMENT, FULL_SLOT);

describe('addPartFromRackChange (decision 12)', () => {
  it('adds the part on the lowest free slot playing the rack, with no Init patch written', () => {
    const model = song();
    const { rack, library, auto } = scope(model);
    const ref = rack();
    const added = addPartFromRackChange(model.doc, (raw) => model.preview(raw), ref, library, auto);
    expect(added?.slot).toBe(4);
    expect(Object.keys(added!.partial.patches ?? {})).toEqual(['kick-rack']);
    model.merge(added!.partial);
    const part = partAt(model.doc, 4)!;
    expect(part.preset).toBe('kick-rack');
    expect(part.rackSource).toBe('kick-rack');
    expect(part.strip.inserts).toEqual(ref.file.inserts);
    expect(part.strip.lowCut).toBe(80);
    expect(part.sequencer.kind).toBe('euclidean');
    expect(model.doc.parts).toHaveLength(5);
    expect(Object.keys(model.doc.patches ?? {}).some((id) => id.startsWith('(init:'))).toBe(false);
  });

  it('is null when the song is full', () => {
    const model = song();
    const { rack, library, auto } = scope(model);
    let doc = model.doc;
    for (let added = addPart(doc); added; added = addPart(doc)) doc = model.preview(added.doc);
    expect(
      addPartFromRackChange(doc, (raw) => model.preview(raw), rack(), library, auto),
    ).toBeNull();
  });
});

describe('rackDifferences (decision 14)', () => {
  function loaded(options = ALL) {
    const model = song();
    const { rack, load } = scope(model);
    const ref = rack(options);
    load(arp, ref);
    const diff = () =>
      rackDifferences(partAt(model.doc, arp)!, model.doc.patches?.['kick-rack'], ref.file);
    return { model, ref, diff };
  }

  it('is empty right after a load', () => {
    expect(loaded().diff()).toEqual([]);
  });

  it('names the member an edit touched', () => {
    const { model, diff } = loaded();
    model.merge(raw({ patches: { 'kick-rack': { volume: 0.1 } } }));
    expect(diff()).toEqual(['patch']);
    model.merge(
      raw({
        parts: { [arp]: { strip: { inserts: [{ kind: 'drive', id: 'd1', drive: 3 }] } } },
      }),
    );
    expect(diff()).toEqual(['patch', 'inserts']);
    model.merge(raw({ parts: { [arp]: { strip: { lowCut: 120 } } } }));
    expect(diff()).toEqual(['patch', 'inserts', 'lowCut']);
    model.merge(raw({ parts: { [arp]: { sequencer: { rotate: 3 } } } }));
    expect(diff()).toEqual(['patch', 'inserts', 'lowCut', 'sequencer']);
  });

  it('never counts a member the rack lacks', () => {
    const { model, diff } = loaded(BARE);
    model.merge(
      raw({
        parts: { [arp]: { strip: { lowCut: 120 }, sequencer: { skipChance: 0.9 } } },
      }),
    );
    expect(diff()).toEqual([]);
  });
});
