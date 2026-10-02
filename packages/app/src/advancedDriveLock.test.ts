/**
 * Advanced Drive's knobs under a lane (windsor#397, record
 * `2026-10-01-song-automation-lanes` decision 6): every knob the card builds
 * names a field the automation catalogue holds, spelled as #341 spells it
 * (`drive`, `stages.0.amount`), and the card's lock (`insertFieldLock`)
 * holds a global knob and a stage knob while a lane on the field is on, and
 * leaves a stage the route skips free.
 */
import { describe, expect, it } from 'vitest';
import { AUTOMATION_DOCUMENT, AUTOMATION_PART } from '@windsor/engine/__fixtures__/automationSong';
import {
  DEFAULT_ADVANCED_DRIVE,
  DRIVE_ROUTES,
  INSERT_AUTOMATION_FIELDS,
  TICKS_PER_BAR,
  songTicksOf,
  type ArrangementDocument,
  type AutomationLane,
} from '@windsor/engine';
import { driveStageField } from './advancedDriveModel';
import {
  DRIVE_GLOBAL_FIELDS,
  DRIVE_MOD_FIELDS,
  DRIVE_ROUTE_FIELDS,
  DRIVE_SOURCE_FIELDS,
  DRIVE_STAGE_FIELDS,
} from './advancedDriveTables';
import type { AppCtx } from './context';
import { insertFieldLock } from './insertKnobs';

const BAR = TICKS_PER_BAR;
const DRIVE_ID = 'ad1';
const SLOT = AUTOMATION_PART.slot;

/** The hat part with only an Advanced Drive on its strip and `lanes` on it. */
function driveSong(lanes: readonly AutomationLane[], route = DEFAULT_ADVANCED_DRIVE.route) {
  const part = {
    ...AUTOMATION_PART,
    strip: {
      ...AUTOMATION_PART.strip,
      inserts: [{ ...DEFAULT_ADVANCED_DRIVE, route, id: DRIVE_ID }],
    },
    automation: lanes,
  };
  const doc: ArrangementDocument = {
    ...AUTOMATION_DOCUMENT,
    parts: AUTOMATION_DOCUMENT.parts.map((p) => (p.slot === SLOT ? part : p)),
  };
  return doc;
}

/** What `insertFieldLock` reads of the console: the document and the transport's tick. */
const consoleAt = (doc: ArrangementDocument, position = 0): AppCtx =>
  ({ model: { doc }, transport: { position: () => position } }) as unknown as AppCtx;

const lane = (field: string, from: number, to: number): AutomationLane => ({
  target: `insert.${DRIVE_ID}.${field}`,
  on: true,
  points: [
    { tick: 0, value: from, bend: 0 },
    { tick: 2 * BAR, value: to, bend: 0 },
  ],
});

const lockOf = (doc: ArrangementDocument, field: string, position = 0): number | undefined =>
  insertFieldLock(consoleAt(doc, position), SLOT, 0, field).automation?.()?.value;

describe('Advanced Drive’s knob fields', () => {
  const catalogued = new Set(INSERT_AUTOMATION_FIELDS['advanced-drive'].map((row) => row.target));

  it('are each a catalogued automation field', () => {
    const globals = [
      ...DRIVE_GLOBAL_FIELDS,
      ...DRIVE_SOURCE_FIELDS,
      ...DRIVE_ROUTES.flatMap((route) => DRIVE_ROUTE_FIELDS[route]),
    ].map(([key]) => key);
    const stages = DEFAULT_ADVANCED_DRIVE.stages.flatMap((_, i) =>
      [...DRIVE_STAGE_FIELDS, ...DRIVE_MOD_FIELDS].map(([key]) => driveStageField(i, key)),
    );
    for (const field of [...globals, ...stages]) expect(catalogued.has(field), field).toBe(true);
  });

  it('spells a stage’s field under its index', () => {
    expect(driveStageField(2, 'amount')).toBe('stages.2.amount');
  });
});

describe('Advanced Drive’s lock', () => {
  const doc = driveSong([lane('drive', -6, 12), lane(driveStageField(0, 'amount'), 0.1, 0.9)]);

  it('holds a global knob and a stage knob at their lanes’ values', () => {
    expect(lockOf(doc, 'drive')).toBe(-6);
    expect(lockOf(doc, 'drive', 2 * BAR)).toBe(12);
    expect(lockOf(doc, driveStageField(0, 'amount'))).toBe(0.1);
  });

  it('leaves free a knob no lane holds', () => {
    expect(lockOf(doc, 'output')).toBeUndefined();
    expect(lockOf(doc, driveStageField(0, 'bias'))).toBeUndefined();
  });

  it('leaves free a stage the route skips, and holds it once the route plays it', () => {
    const skipped = [lane(driveStageField(1, 'amount'), 0.2, 0.8)];
    expect(lockOf(driveSong(skipped, 'single'), driveStageField(1, 'amount'))).toBeUndefined();
    expect(lockOf(driveSong(skipped, 'serial'), driveStageField(1, 'amount'))).toBe(0.2);
  });

  it('starts its lane again past the song’s end', () => {
    expect(lockOf(doc, 'drive', songTicksOf(doc))).toBe(-6);
  });

  it('holds nothing on a send bus, which carries no lanes', () => {
    expect(insertFieldLock(consoleAt(doc), 'a', 0, 'drive').automation).toBeUndefined();
  });
});
