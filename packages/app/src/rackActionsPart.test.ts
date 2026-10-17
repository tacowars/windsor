/**
 * The pure rack rules (windsor#868, record `2026-10-17-racks` decisions 12
 * and 14) over the full fixture: a part added from a rack, and the
 * member-by-member difference the rack's modified dot reads.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { partAt } from '@windsor/engine';
import { FULL_DOCUMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import { addPartFromRackChange, rackDifferences, renamedRack, saveMembersFor } from './rackActions';
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

describe('the name leaf (decision 14 as amended, windsor#884)', () => {
  it('never counts: a renamed song copy is unmodified against its rack', () => {
    const model = song();
    const { rack, load } = scope(model);
    const ref = rack();
    load(arp, ref);
    const copy = model.doc.patches!['kick-rack']!;
    model.merge(raw({ patches: { 'kick-rack': { ...copy, name: 'Other Name' } } }));
    expect(
      rackDifferences(partAt(model.doc, arp)!, model.doc.patches?.['kick-rack'], ref.file),
    ).toEqual([]);
  });

  it('leaves a key from another part out of the chain comparison, as the file writes it (decision 3)', () => {
    const model = song();
    const { rack } = scope(model);
    const ref = rack();
    // The kick's own chain keys its compressor from the hat; the rack wrote that key disconnected.
    const kick = partAt(model.doc, FULL_SLOT.kick)!;
    expect(
      rackDifferences(kick, model.doc.patches?.[kick.preset], {
        ...ref.file,
        patch: model.doc.patches![kick.preset]!,
      }),
    ).toEqual([]);
  });

  it('renames a rack and its patch together, the rest untouched', () => {
    const { rack } = scope(song());
    const renamed = renamedRack(rack().file, 'Kick Room');
    expect(renamed.name).toBe('Kick Room');
    expect(renamed.patch.name).toBe('Kick Room');
    expect({ ...renamed, name: rack().file.name, patch: rack().file.patch }).toEqual(rack().file);
  });
});

describe('saveMembersFor (decision 13, windsor#885)', () => {
  it('checks the low cut above its floor and the sequencer when the kind is not none', () => {
    const model = song();
    const { kick, hat } = FULL_SLOT;
    // The scope sets the kick's low cut to 80 Hz; the hat keeps the floor.
    expect(saveMembersFor(partAt(model.doc, kick)!)).toEqual({ lowCut: true, sequencer: true });
    expect(saveMembersFor(partAt(model.doc, hat)!)).toEqual({ lowCut: false, sequencer: true });
    model.merge(raw({ parts: { [hat]: { sequencer: { kind: 'none' } } } }));
    expect(saveMembersFor(partAt(model.doc, hat)!)).toEqual({ lowCut: false, sequencer: false });
  });
});

describe('the same rack loaded again (Revert rack, windsor#885)', () => {
  it('writes over the part’s own copy and leaves none behind', () => {
    const model = song();
    const { rack, load } = scope(model);
    const ref = rack();
    load(arp, ref);
    const preset = partAt(model.doc, arp)!.preset;
    const count = Object.keys(model.doc.patches ?? {}).length;
    model.merge(raw({ patches: { [preset]: { volume: 0.123 } } }));
    load(arp, ref);
    load(arp, ref);
    expect(partAt(model.doc, arp)!.preset).toBe(preset);
    expect(Object.keys(model.doc.patches ?? {})).toHaveLength(count);
    expect(model.doc.patches![preset]!.volume).toBe(ref.file.patch.volume);
  });
});
