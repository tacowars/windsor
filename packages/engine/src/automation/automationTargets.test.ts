import { describe, expect, it } from 'vitest';
import { INSERT_KIND_NAMES } from '../inserts/insertRegistry';
import { INSERT_AUTOMATION_FIELDS } from './automationInsertTables';
import type { ParsedTarget } from './automationLane';
import {
  STRIP_TARGET_IDS,
  VOICE_TARGET_IDS,
  catalogRow,
  formatTargetId,
  insertTargetRow,
  parseTargetId,
  targetKind,
  targetRow,
} from './automationTargets';

const INSERT_IDS = INSERT_KIND_NAMES.flatMap((kind) =>
  INSERT_AUTOMATION_FIELDS[kind].map((row) => `insert.k3x9a0q2.${row.target}`),
);
const EVERY_ID = [...STRIP_TARGET_IDS, ...VOICE_TARGET_IDS, ...INSERT_IDS];

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
      'insert.ab12cd34.enabled',
      'insert.ab12cd34.bands.8.freq',
      'master.level',
      'strip',
    ]) {
      expect(parseTargetId(id), id).toBeUndefined();
    }
  });

  it('refuse to format an unknown target', () => {
    const bad: ParsedTarget[] = [
      { kind: 'strip', field: 'lowCut' },
      { kind: 'voice', path: 'volume' },
      { kind: 'insert', insertId: 'ab.cd', field: 'mix' },
      { kind: 'insert', insertId: 'ab12cd34', field: 'route' },
    ];
    for (const target of bad) expect(() => formatTargetId(target)).toThrow(RangeError);
  });
});

describe('targetKind', () => {
  it('names the family', () => {
    expect(targetKind('strip.level')).toBe('strip');
    expect(targetKind('insert.ab12cd34.mix')).toBe('insert');
    expect(targetKind('voice.lfo2.rate')).toBe('voice');
  });
});

describe('the row lookups', () => {
  it('find strip and voice rows by id', () => {
    expect(catalogRow('strip.pan')?.min).toBe(-1);
    expect(catalogRow('voice.filter.cutoff')?.scale).toBe('octaves');
    expect(catalogRow('insert.ab12cd34.mix')).toBeUndefined();
  });

  it("find an insert row through its insert's kind", () => {
    expect(insertTargetRow('eq', 'bands.0.gain')?.unit).toBe('dB');
    expect(insertTargetRow('chorus', 'bands.0.gain')).toBeUndefined();
    const kinds: Record<string, 'phaser'> = { ph000001: 'phaser' };
    const kindOf = (id: string) => kinds[id];
    expect(targetRow('insert.ph000001.center', kindOf)?.scale).toBe('log');
    expect(targetRow('insert.zz000009.center', kindOf)).toBeUndefined();
    expect(targetRow('insert.ph000001.bands.0.q', kindOf)).toBeUndefined();
    expect(targetRow('insert.ph000001.center')).toBeUndefined();
    expect(targetRow('voice.pitchEnvAmount')?.unit).toBe('st');
    expect(targetRow('voice.nothing')).toBeUndefined();
  });
});
