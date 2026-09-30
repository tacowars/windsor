import { describe, expect, it } from 'vitest';
import { DEFAULT_ADVANCED_DRIVE, DRIVE_ROUTES } from '@windsor/engine';
import { drivePages, editDriveStage } from './advancedDriveModel';
import { DRIVE_ROUTE_STAGES } from './advancedDriveTables';
import { emptyRack, showPage, viewAt } from './insertRackModel';

describe('drivePages (windsor#174)', () => {
  const names = (route: (typeof DRIVE_ROUTES)[number]): string[] =>
    drivePages(route).map((page) => page.name);

  it('shows Main, one Stage page per stage the routing uses, then Mod', () => {
    expect(names('single')).toEqual(['Main', 'Stage 1', 'Mod']);
    for (const route of ['serial', 'parallel', 'mid-side'] as const)
      expect(names(route), route).toEqual(['Main', 'Stage 1', 'Stage 2', 'Mod']);
    expect(names('multiband')).toEqual(['Main', 'Stage 1', 'Stage 2', 'Stage 3', 'Mod']);
  });

  it('has a stage list for every routing, inside the stages the insert holds', () => {
    for (const route of DRIVE_ROUTES) {
      const stages = DRIVE_ROUTE_STAGES[route];
      expect(stages.length, route).toBeGreaterThan(0);
      expect(stages.length, route).toBeLessThanOrEqual(DEFAULT_ADVANCED_DRIVE.stages.length);
    }
  });

  it('shows Main after multiband on Stage 3 becomes single, and keeps Mod', () => {
    const multiband = names('multiband');
    const onStage3 = showPage(emptyRack(), 0, 0, multiband, multiband.indexOf('Stage 3'));
    expect(viewAt(onStage3, 0, 0, names('single')).page).toBe(0);
    const onMod = showPage(emptyRack(), 0, 0, multiband, multiband.indexOf('Mod'));
    expect(names('single')[viewAt(onMod, 0, 0, names('single')).page]).toBe('Mod');
  });
});
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
