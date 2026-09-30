import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPRESSOR, INSERT_KINDS, makeArrangement } from '@windsor/engine';
import { COMPRESSOR_KNOBS, COMPRESSOR_SELECTS } from './compressorTables';
import { setInsertField } from './insertEdits';
import { DocumentModel } from './documentModel';
import { newSong } from './songParts';

describe('compressor controls and document', () => {
  it('covers every setting and uses engine defaults', () => {
    const fields = [
      'kind',
      'enabled',
      'sidechain',
      ...COMPRESSOR_KNOBS.map((k) => k.f),
      ...COMPRESSOR_SELECTS.map((s) => s.field),
    ];
    expect(fields.sort()).toEqual([...INSERT_KINDS.compressor.fields].sort());
    for (const { f, o } of COMPRESSOR_KNOBS) expect(o.def).toBe(DEFAULT_COMPRESSOR[f]);
    for (const { field, values } of COMPRESSOR_SELECTS)
      expect(values).toContain(DEFAULT_COMPRESSOR[field]);
  });
  it('keeps every field, including bypass, through edits and normalization round trips', () => {
    const song = makeArrangement(newSong()).document;
    const spec = {
      ...DEFAULT_COMPRESSOR,
      threshold: -20,
      makeup: 6,
      attack: 0.3,
      ratio: 10,
      release: 0.4,
      highpass: 200,
      range: 8,
      mix: 0.4,
      enabled: false,
      id: 'comp',
    };
    const raw = {
      ...song,
      parts: song.parts.map((p) => ({ ...p, strip: { ...p.strip, inserts: [spec] } })),
    };
    const loaded = makeArrangement(raw);
    expect(loaded.corrections).toEqual([]);
    expect(loaded.document.parts[0]!.strip.inserts).toEqual([spec]);
    expect(makeArrangement(JSON.parse(JSON.stringify(loaded.document))).document).toEqual(
      loaded.document,
    );
    expect(setInsertField([spec], 0, 'enabled', true)).toEqual([{ ...spec, enabled: true }]);
    expect(new DocumentModel(newSong()).doc.parts[0]!.strip.inserts).toEqual([]);
  });
});
