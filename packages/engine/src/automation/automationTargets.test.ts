import { describe, expect, it } from 'vitest';
import { DEFAULT_CHORUS } from '../inserts/chorusInsert';
import { DEFAULT_ECHO } from '../inserts/echoInsert';
import { DEFAULT_EQ } from '../inserts/eqSpec';
import { CHORUS_RATE_MAX_HZ, CHORUS_RATE_MIN_HZ } from '../inserts/insertConstants';
import { PHASER_BOUNDS } from '../inserts/phaserConstants';
import { DEFAULT_PHASER } from '../inserts/phaserSpec';
import { INSERT_KIND_NAMES, type InsertSpec } from '../inserts/insertRegistry';
import { insertKindFields } from './automationInsertFields';
import { SEQ_AUTOMATION_ROWS } from './automationSeqTables';
import type { ParsedTarget } from './automationLane';
import {
  STRIP_TARGET_IDS,
  VOICE_TARGET_IDS,
  catalogRow,
  formatTargetId,
  insertTargetRow,
  isGroupTarget,
  parseTargetId,
  requireCatalogRow,
  seqTargetIds,
  targetKind,
  targetRow,
} from './automationTargets';
import { GROUP_STRIP_TARGETS } from './automationTargetTables';

const INSERT_IDS = INSERT_KIND_NAMES.flatMap((kind) =>
  insertKindFields(kind).map((row) => `insert.k3x9a0q2.${row.target}`),
);
const SEQ_IDS = SEQ_AUTOMATION_ROWS.map((row) => row.target);
const EVERY_ID = [...STRIP_TARGET_IDS, ...VOICE_TARGET_IDS, ...INSERT_IDS, ...SEQ_IDS];

describe('parseTargetId and formatTargetId', () => {
  it('round-trip every id', () => {
    for (const id of EVERY_ID) {
      const parsed = parseTargetId(id);
      expect(parsed, id).toBeDefined();
      expect(formatTargetId(parsed!)).toBe(id);
    }
  });

  it('take each family apart', () => {
    expect(parseTargetId('strip.send.b')).toEqual({ kind: 'strip', field: 'send.b' });
    expect(parseTargetId('voice.ops.2.width')).toEqual({ kind: 'voice', path: 'ops.2.width' });
    expect(parseTargetId('seq.skipChance')).toEqual({ kind: 'seq', field: 'skipChance' });
    expect(parseTargetId('insert.ab12cd34.bands.3.freq')).toEqual({
      kind: 'insert',
      insertId: 'ab12cd34',
      field: 'bands.3.freq',
    });
  });

  it('reject unknown ids', () => {
    for (const id of [
      '',
      'strip.lowCut',
      'strip.send.c',
      'voice.volume',
      'voice.ops.4.level',
      'voice.filter.mode',
      'insert.ab12cd34',
      'insert..mix',
      'insert.ab12cd34.kind',
      'insert.ab12cd34.bands.8.freq',
      'master.level',
      'seq.divisor',
      'strip',
    ]) {
      expect(parseTargetId(id), id).toBeUndefined();
    }
  });

  it('refuse to format an unknown target', () => {
    const bad: ParsedTarget[] = [
      { kind: 'strip', field: 'lowCut' },
      { kind: 'voice', path: 'volume' },
      { kind: 'insert', insertId: '', field: 'mix' },
      { kind: 'insert', insertId: 'ab12cd34', field: 'route' },
      { kind: 'insert', insertId: 'echo.main', field: 'bands.8.freq' },
    ];
    for (const target of bad) expect(() => formatTargetId(target)).toThrow(RangeError);
  });
});

describe('an insert id with dots', () => {
  const FIELDS = [
    ...new Set(INSERT_KIND_NAMES.flatMap((k) => insertKindFields(k).map((row) => row.target))),
  ];
  const ODD_IDS = [
    'echo.main',
    'a.b.c',
    'a.',
    '.a',
    '..',
    'mix',
    'a.mix',
    'a.enabled',
    'x.bands.3',
    'bands.3',
    'x.stages.0',
    'stages.0',
    'stages.0.bias',
    'x.stages.0.level',
    'x.bands',
    '100%',
    'a%2Eb',
    'a%25b',
    '%',
  ];

  it('reads the field from the end, longest first', () => {
    expect(parseTargetId('insert.echo.main.mix')).toEqual({
      kind: 'insert',
      insertId: 'echo.main',
      field: 'mix',
    });
    expect(parseTargetId('insert.eq.lead.bands.3.freq')).toEqual({
      kind: 'insert',
      insertId: 'eq.lead',
      field: 'bands.3.freq',
    });
    expect(formatTargetId({ kind: 'insert', insertId: 'echo.main', field: 'mix' })).toBe(
      'insert.echo.main.mix',
    );
  });

  it('round-trips any non-empty id with every field', () => {
    for (const insertId of ODD_IDS) {
      for (const field of FIELDS) {
        const target: ParsedTarget = { kind: 'insert', insertId, field };
        const id = formatTargetId(target);
        expect(parseTargetId(id), id).toEqual(target);
      }
    }
  });

  it('escapes only an id the plain reading would take apart wrongly', () => {
    expect(formatTargetId({ kind: 'insert', insertId: 'x.stages.0', field: 'bias' })).toBe(
      'insert.x%2Estages%2E0.bias',
    );
    expect(formatTargetId({ kind: 'insert', insertId: '100%', field: 'mix' })).toBe(
      'insert.100%25.mix',
    );
    expect(formatTargetId({ kind: 'insert', insertId: 'x.stages.0', field: 'mix' })).toBe(
      'insert.x.stages.0.mix',
    );
  });

  it('holds one spelling per target', () => {
    expect(parseTargetId('insert.echo%2Emain.mix')).toBeUndefined();
    expect(parseTargetId('insert.a%b.mix')).toBeUndefined();
    expect(parseTargetId('insert.x.stages.0.bias')).toEqual({
      kind: 'insert',
      insertId: 'x',
      field: 'stages.0.bias',
    });
  });
});

describe('targetKind', () => {
  it('names the family', () => {
    expect(targetKind('strip.level')).toBe('strip');
    expect(targetKind('insert.ab12cd34.mix')).toBe('insert');
    expect(targetKind('voice.lfo2.rate')).toBe('voice');
    expect(targetKind('seq.gate')).toBe('seq');
  });
});

describe('the row lookups', () => {
  it('find strip and voice rows by id', () => {
    expect(catalogRow('strip.pan')?.min).toBe(-1);
    expect(catalogRow('voice.filter.cutoff')?.scale).toBe('octaves');
    expect(catalogRow('insert.ab12cd34.mix')).toBeUndefined();
  });

  it('require a strip or voice row, throwing a RangeError that names a missing id', () => {
    expect(requireCatalogRow('strip.pan')).toBe(catalogRow('strip.pan'));
    expect(() => requireCatalogRow('voice.nothing')).toThrow(RangeError);
    expect(() => requireCatalogRow('voice.nothing')).toThrow('"voice.nothing"');
  });

  it("find an insert row through its insert's spec", () => {
    expect(insertTargetRow(DEFAULT_EQ, 'bands.0.gain')?.unit).toBe('dB');
    expect(insertTargetRow(DEFAULT_CHORUS, 'bands.0.gain')).toBeUndefined();
    const specs: Record<string, InsertSpec> = { ph000001: DEFAULT_PHASER };
    const specOf = (id: string) => specs[id];
    expect(targetRow('insert.ph000001.center', specOf)?.scale).toBe('log');
    expect(targetRow('insert.zz000009.center', specOf)).toBeUndefined();
    expect(targetRow('insert.ph000001.bands.0.q', specOf)).toBeUndefined();
    expect(targetRow('insert.ph000001.center')).toBeUndefined();
    expect(targetRow('voice.pitchEnvAmount')?.unit).toBe('st');
    expect(targetRow('voice.nothing')).toBeUndefined();
  });
});

describe("a host's slot targets (record 2026-10-11-wet-path-slot)", () => {
  const echoWith = (slot: InsertSpec | null): InsertSpec => ({ ...DEFAULT_ECHO, slot });

  it('parse, format and round-trip insert.<hostId>.slot.<field>, an escaped id included', () => {
    expect(parseTargetId('insert.e1.slot.rate')).toEqual({
      kind: 'insert',
      insertId: 'e1',
      field: 'slot.rate',
    });
    for (const insertId of ['e1', 'echo.main', 'x.slot', '100%']) {
      const target = { kind: 'insert', insertId, field: 'slot.rate' } as const;
      const id = formatTargetId(target);
      expect(parseTargetId(id), id).toEqual(target);
    }
    expect(formatTargetId({ kind: 'insert', insertId: '100%', field: 'slot.rate' })).toBe(
      'insert.100%25.slot.rate',
    );
    // `x.slot`'s `rate` is not `x`'s `slot.rate`: the dot is escaped.
    expect(formatTargetId({ kind: 'insert', insertId: 'x.slot', field: 'rate' })).toBe(
      'insert.x%2Eslot.rate',
    );
  });

  it("give the live child kind's row, and none with the slot empty or the field missing", () => {
    const phaser = echoWith({ ...DEFAULT_PHASER, id: 'p' });
    const chorus = echoWith({ ...DEFAULT_CHORUS, id: 'c' });
    const rate = targetRow('insert.e1.slot.rate', () => phaser);
    expect(rate).toMatchObject({
      label: 'Slot Rate',
      min: PHASER_BOUNDS.rate[0],
      max: PHASER_BOUNDS.rate[1],
      scale: 'log',
    });
    expect(targetRow('insert.e1.slot.rate', () => chorus)).toMatchObject({
      label: 'Slot Rate',
      min: CHORUS_RATE_MIN_HZ,
      max: CHORUS_RATE_MAX_HZ,
    });
    expect(insertTargetRow(phaser, 'slot.enabled')).toMatchObject({ scale: 'switch' });
    expect(insertTargetRow(phaser, 'slot.mix')).toMatchObject({ label: 'Slot Mix' });
    expect(insertTargetRow(echoWith(null), 'slot.rate')).toBeUndefined();
    expect(insertTargetRow(DEFAULT_ECHO, 'slot.rate')).toBeUndefined();
    expect(insertTargetRow(chorus, 'slot.center')).toBeUndefined();
    expect(insertTargetRow(DEFAULT_PHASER, 'slot.rate')).toBeUndefined();
    expect(insertTargetRow(phaser, 'mix')).toMatchObject({ label: 'Mix', max: 1 });
  });
});

describe('group targets (windsor#614)', () => {
  it("are a group's level and pan, and any insert field, from the catalog's own ids", () => {
    expect(GROUP_STRIP_TARGETS).toEqual(['strip.level', 'strip.pan']);
    for (const id of GROUP_STRIP_TARGETS) expect(STRIP_TARGET_IDS).toContain(id);
    expect(STRIP_TARGET_IDS.filter((id) => isGroupTarget(id))).toEqual(GROUP_STRIP_TARGETS);
    expect(isGroupTarget('insert.phase1.rate')).toBe(true);
    expect(isGroupTarget('insert.eq1.bands.3.freq')).toBe(true);
  });

  it('never a send, a voice or a sequencer target, nor an id that does not parse', () => {
    for (const id of ['strip.send.a', 'strip.send.b', 'strip.volume', 'insert.x', '']) {
      expect(isGroupTarget(id)).toBe(false);
    }
    for (const id of VOICE_TARGET_IDS) expect(isGroupTarget(id)).toBe(false);
    for (const id of [...seqTargetIds('figure'), ...seqTargetIds('bass')]) {
      expect(isGroupTarget(id)).toBe(false);
    }
  });
});
