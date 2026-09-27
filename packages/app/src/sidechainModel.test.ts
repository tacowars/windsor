import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPRESSOR } from '@windsor/engine/inserts/compressorSpec';
import { FULL_DOCUMENT } from '@windsor/engine/__fixtures__/fullArrangement';
import { makeArrangement } from '@windsor/engine/song/arrangementDocument';
import { removePart, removePartChange } from '@windsor/engine/song/documentParts';
import {
  documentSidechains,
  invalidSidechains,
  canSidechain,
} from '@windsor/engine/mixer/sidechainGraph';
import { planSidechains } from '@windsor/engine/mixer/sidechainPlan';
import { DocumentModel } from './documentModel';
const comp = (track: number | null) => ({ ...DEFAULT_COMPRESSOR, sidechain: { track } });
const document = () => ({
  ...FULL_DOCUMENT,
  parts: FULL_DOCUMENT.parts.map((part, i) => ({
    ...part,
    strip: { ...part.strip, output: 'sidechain' as const, inserts: i === 1 ? [comp(0)] : [] },
  })),
  master: { level: 1, inserts: [comp(0)] },
});
describe('post-FX sidechain song contract', () => {
  it('round trips both targets and output, leaving old songs unchanged', () => {
    const normalized = makeArrangement(document());
    expect(normalized.dangling).toEqual([]);
    expect(makeArrangement(JSON.parse(JSON.stringify(normalized.document))).document).toEqual(
      normalized.document,
    );
    expect(makeArrangement(FULL_DOCUMENT).document.parts[0]!.strip.output).toBeUndefined();
  });
  it('repairs missing sources to disconnected external and cannot revive them by slot reuse', () => {
    const doc = document();
    const model = new DocumentModel(doc);
    const change = removePartChange(doc, 0)!;
    model.merge(change);
    expect(model.dangling).toEqual([]);
    expect(model.doc).toEqual(makeArrangement(removePart(doc, 0)).document);
    expect(model.doc.master!.inserts[0]).toMatchObject({ sidechain: { track: null } });
    model.merge({ parts: { 0: doc.parts[0] } });
    expect(model.doc.master!.inserts[0]).toMatchObject({ sidechain: { track: null } });
  });
  it('uses one cycle rule for imports, prospective edits and the selector', () => {
    const doc = document();
    expect(canSidechain(doc, 1, 0, 1)).toBe(false);
    expect(canSidechain(doc, 'master', 0, 1)).toBe(true);
    const graph = documentSidechains(doc);
    const update = { parts: { 0: { strip: { inserts: [comp(1)] } } } };
    expect(planSidechains(graph, update).error).toMatch(/cycle/);
    const model = new DocumentModel(doc);
    model.merge(update);
    expect(model.dangling).toHaveLength(2);
    expect(invalidSidechains(documentSidechains(model.doc))).toEqual([]);
    expect(model.doc.parts[0]!.strip.inserts[0]).toMatchObject({ sidechain: { track: null } });
  });
  it('preserves a source through renaming and parameter edits', () => {
    const model = new DocumentModel(document());
    model.merge({ parts: { 0: { name: 'Trigger renamed', strip: { level: 0.5 } } } });
    expect(model.doc.master!.inserts[0]).toMatchObject({ sidechain: { track: 0 } });
  });
});
