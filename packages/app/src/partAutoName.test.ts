/**
 * windsor#103: a generic part takes the first six graphemes of the first
 * patch it is given, on a library pick and when a song opens; a typed name,
 * an Init part and a later pick are left alone.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DocumentPartial } from '@windsor/engine';
import { clonePatch, partAt } from '@windsor/engine';
import { PRESETS } from '@windsor/engine/patch/presets';
import type { AppCtx } from './context';
import { partChange } from './context';
import { DocumentModel } from './documentModel';
import { initPresetId } from './libraryConstants';
import { library, loadPageLibrary } from './libraryModel';
import {
  assignPatchFields,
  autoName,
  autoPartName,
  isGenericPartName,
  loadRenames,
  reportFinalPartNames,
} from './partAutoName';
import { choosePreset } from './presetBrowser';
import { addPart, newSong } from './songParts';

beforeAll(() => loadPageLibrary(library));

/** A console context over a new song with a second part added on slot 1. */
function context(): AppCtx {
  const first = new DocumentModel(newSong());
  const added = addPart(first.doc)!;
  const model = new DocumentModel(added.doc);
  return {
    model,
    change: (partial: DocumentPartial) => {
      model.merge(partial);
      return { ok: true, ignored: [] };
    },
  } as unknown as AppCtx;
}

const input = (name: string, patchName: string | undefined, slot = 1) => ({
  slot,
  name,
  preset: 'some-patch',
  patchName,
});

describe('the generic name', () => {
  it('is the slot default or empty, and nothing else', () => {
    expect(isGenericPartName('Part 2', 1)).toBe(true);
    expect(isGenericPartName('', 1)).toBe(true);
    expect(isGenericPartName('Part 7', 1)).toBe(false);
    expect(isGenericPartName('Lead', 1)).toBe(false);
  });
});

describe('the patch-based name', () => {
  it('takes six characters and trims the space they end on', () => {
    expect(autoName('Glass Bells')).toBe('Glass');
    expect(autoName('Glass Horizon')).toBe('Glass');
    expect(autoName('Saw Arp')).toBe('Saw Ar');
  });
  it('uses a short name whole', () => {
    expect(autoName('Pad')).toBe('Pad');
  });
  it('drops leading spaces before counting', () => {
    expect(autoName('   Bright Keys')).toBe('Bright');
  });
  it('counts graphemes, never cutting an accent or an emoji', () => {
    // A decomposed é is two code units and one grapheme: the six end at the N.
    expect(autoName('Café Noir')).toBe('Café N');
    expect(autoName('👩‍🚀🎹 Space Keys')).toBe('👩‍🚀🎹 Spa');
  });
  it('leaves an empty or blank patch name alone', () => {
    expect(autoName('')).toBeNull();
    expect(autoPartName(input('Part 2', '   '))).toBeNull();
  });
  it('renames a generic part only', () => {
    expect(autoPartName(input('Part 2', 'Glass Bells'))).toBe('Glass');
    expect(autoPartName(input('Lead', 'Glass Bells'))).toBeNull();
    expect(autoPartName(input('Part 7', 'Glass Bells'))).toBeNull();
  });
  it('never names a part after its Init sentinel or a missing patch', () => {
    expect(autoPartName({ ...input('Part 2', 'Init'), preset: initPresetId('1') })).toBeNull();
    expect(autoPartName(input('Part 2', undefined))).toBeNull();
  });
});

describe('assigning a patch', () => {
  it('names a generic part after its first patch, in the same edit', () => {
    const ctx = context();
    expect(assignPatchFields(ctx.model.doc, 1, 'saw-arp', 'Saw Arp')).toEqual({
      preset: 'saw-arp',
      name: 'Saw Ar',
    });
    expect(choosePreset(ctx, 1, 'saw-arp')).toBe(true);
    expect(partAt(ctx.model.doc, 1)?.name).toBe('Saw Ar');
    expect(partAt(ctx.model.doc, 0)?.name).toBe('Part 1');
  });
  it('keeps the name when a second patch is picked', () => {
    const ctx = context();
    choosePreset(ctx, 1, 'saw-arp');
    choosePreset(ctx, 1, 'score-glass-horizon');
    expect(partAt(ctx.model.doc, 1)?.preset).toBe('score-glass-horizon');
    expect(partAt(ctx.model.doc, 1)?.name).toBe('Saw Ar');
  });
  it('keeps a name the user typed', () => {
    const ctx = context();
    ctx.change(partChange(1, { name: 'Lead' }));
    choosePreset(ctx, 1, 'saw-arp');
    expect(partAt(ctx.model.doc, 1)?.name).toBe('Lead');
  });
  it('writes the name into the export', () => {
    const ctx = context();
    choosePreset(ctx, 1, 'score-glass-horizon');
    const reopened = new DocumentModel(JSON.parse(ctx.model.toJson()));
    expect(partAt(reopened.doc, 1)?.name).toBe('Glass');
  });
});

describe('opening a song', () => {
  it('renames a generic part that already plays a patch, and nothing else', () => {
    const ctx = context();
    const doc = ctx.model.doc;
    const patches = { ...doc.patches, 'saw-arp': clonePatch(PRESETS['saw-arp']!) };
    const parts = doc.parts.map((part) =>
      part.slot === 1 ? { ...part, preset: 'saw-arp' } : part,
    );
    const model = new DocumentModel({ ...doc, parts, patches });
    const renames = loadRenames(model.doc);
    expect(renames).toEqual({ parts: { 1: { name: 'Saw Ar' } } });
    model.merge(renames);
    expect(model.changed).toBe(true);
    expect(partAt(model.doc, 0)?.name).toBe('Part 1');
    expect(loadRenames(model.doc)).toBeNull();
  });
  it('keeps the import report of the song as opened through the rename', () => {
    const doc = context().model.doc;
    const patches = { ...doc.patches, 'saw-arp': clonePatch(PRESETS['saw-arp']!) };
    const renamed = doc.parts.map((part) =>
      part.slot === 1 ? { ...part, preset: 'saw-arp' } : part,
    );
    const lost = { ...renamed[0]!, slot: 2, preset: 'nope' };
    const model = new DocumentModel(newSong());
    model.open({ ...doc, parts: [...renamed, lost], patches }, loadRenames);
    expect(partAt(model.doc, 1)?.name).toBe('Saw Ar');
    expect(partAt(model.doc, 2)).toBeUndefined();
    expect(model.dangling).toEqual(['parts[2].preset: no preset "nope" is defined']);
    expect(model.changed).toBe(true);
  });
  it('reports a malformed name as the name the part ends up with (windsor#114)', () => {
    const doc = context().model.doc;
    const patches = { ...doc.patches, 'saw-arp': clonePatch(PRESETS['saw-arp']!) };
    const parts = doc.parts.map((part) =>
      part.slot === 1 ? { ...part, name: 7, preset: 'saw-arp' } : part,
    );
    const model = new DocumentModel(newSong());
    model.open({ ...doc, parts, patches }, loadRenames);
    expect(partAt(model.doc, 1)?.name).toBe('Saw Ar');
    expect(model.corrections).toEqual([
      'parts[1].name: 7 is not a name — named after its patch: "Saw Ar"',
    ]);
    expect(model.corrections.join('\n')).not.toContain('Part 2');
  });
  it("leaves a dropped duplicate's malformed name reported as its fallback (windsor#114)", () => {
    const doc = context().model.doc;
    const patches = { ...doc.patches, 'saw-arp': clonePatch(PRESETS['saw-arp']!) };
    const parts = doc.parts.flatMap((part): { name: unknown; preset: string }[] =>
      part.slot === 1
        ? [
            { ...part, name: 7, preset: 'saw-arp' },
            { ...part, name: 8, preset: 'saw-arp' },
          ]
        : [part],
    );
    const survivor = parts.findIndex((part) => part.name === 7);
    const duplicate = survivor + 1;
    const model = new DocumentModel(newSong());
    model.open({ ...doc, parts, patches }, loadRenames);
    expect(partAt(model.doc, 1)?.name).toBe('Saw Ar');
    expect(model.corrections).toEqual([
      `parts[${survivor}].name: 7 is not a name — named after its patch: "Saw Ar"`,
      `parts[${duplicate}].name: 8 is not a name — using "Part 2"`,
      `parts[${duplicate}]: slot 1 is already used — part dropped`,
    ]);
  });
  it('reports a clean generic import as it did before the rename', () => {
    const doc = context().model.doc;
    const patches = { ...doc.patches, 'saw-arp': clonePatch(PRESETS['saw-arp']!) };
    const parts = doc.parts.map((part) =>
      part.slot === 1 ? { ...part, preset: 'saw-arp' } : part,
    );
    const plain = new DocumentModel(newSong());
    plain.open({ ...doc, parts, patches });
    const model = new DocumentModel(newSong());
    model.open({ ...doc, parts, patches }, loadRenames);
    expect(partAt(model.doc, 1)?.name).toBe('Saw Ar');
    expect(model.corrections).toEqual(plain.corrections);
  });
  it('leaves a malformed name that no rename touched reported as its fallback', () => {
    const line = 'parts[1].name: 7 is not a name — using "Part 2"';
    const parts = [{ slot: 1, name: 'Part 2' }] as never;
    expect(reportFinalPartNames([line, 'other'], { parts })).toEqual([line, 'other']);
  });
  it('leaves a song of Init parts and typed names alone', () => {
    expect(loadRenames(context().model.doc)).toBeNull();
  });
});
