import { expect, it } from 'vitest';
import { DEFAULT_ADVANCED_DRIVE } from '@windsor/engine';
import { editDriveStage } from './advancedDriveModel';
import { addInsert } from './insertEdits';
import { insertChange } from './insertTarget';
import { DocumentModel } from './documentModel';
it('edits one stage immutably and new insert defaults do not share stage objects', () => {
  const a = addInsert([], 'advanced-drive')[0];
  const b = addInsert([], 'advanced-drive')[0];
  if (a?.kind !== 'advanced-drive' || b?.kind !== 'advanced-drive') throw new Error('wrong kind');
  expect(a.stages).not.toBe(b.stages);
  expect(a.stages[0]).not.toBe(DEFAULT_ADVANCED_DRIVE.stages[0]);
  const next = editDriveStage(a, 2, 'bias', 0.6);
  expect(next.stages[2]!.bias).toBe(0.6);
  expect(a.stages[2]!.bias).toBe(0);
  expect(next.stages[0]).toBe(a.stages[0]);
});
it('stage edits round-trip through both part and master document partials', () => {
  const model = new DocumentModel({
    version: 2,
    parts: [{ slot: 0, name: 'Drive test', preset: 'saw-arp', sequencer: { kind: 'none' } }],
  });
  const slot = model.doc.parts[0]!.slot;
  const edited = editDriveStage(
    { ...DEFAULT_ADVANCED_DRIVE, route: 'multiband' },
    2,
    'lfoBias',
    -0.4,
  );
  for (const target of [slot, 'master'] as const) {
    const partial = insertChange(target, [edited]);
    model.merge(partial);
    const reopened = new DocumentModel(JSON.parse(model.toJson()));
    expect(reopened.doc).toEqual(model.doc);
    expect(
      target === 'master' ? reopened.doc.master!.inserts : reopened.doc.parts[0]!.strip.inserts,
    ).toEqual([edited]);
    expect(partial).toEqual(
      target === 'master'
        ? { master: { inserts: [edited] } }
        : { parts: { [slot]: { strip: { inserts: [edited] } } } },
    );
  }
});
