import { describe, expect, it } from 'vitest';
import { INSERT_KINDS, INSERT_KIND_NAMES } from '../inserts/insertRegistry';
import { INSERT_AUTOMATION_FIELDS } from './automationInsertTables';

/** The value at a dotted path, with list indices as segments. */
function at(spec: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, key) => (o as Record<string, unknown>)?.[key], spec);
}

describe('INSERT_AUTOMATION_FIELDS', () => {
  it('lists every insert kind', () => {
    expect(Object.keys(INSERT_AUTOMATION_FIELDS).sort()).toEqual([...INSERT_KIND_NAMES].sort());
  });

  it("names numbers the kind's defaults hold, each inside its row", () => {
    for (const kind of INSERT_KIND_NAMES) {
      const defaults = INSERT_KINDS[kind].defaults;
      const rows = INSERT_AUTOMATION_FIELDS[kind];
      expect(new Set(rows.map((r) => r.target)).size, kind).toBe(rows.length);
      for (const row of rows) {
        const value = at(defaults, row.target);
        expect(typeof value, `${kind}.${row.target}`).toBe('number');
        expect(row.min, `${kind}.${row.target}`).toBeLessThan(row.max);
        expect(value as number).toBeGreaterThanOrEqual(row.min);
        expect(value as number).toBeLessThanOrEqual(row.max);
        if (row.scale !== 'linear')
          expect(row.floor ?? row.min, `${kind}.${row.target}`).toBeGreaterThan(0);
      }
    }
  });

  it('leaves out the stepped and chosen fields', () => {
    const fields = (kind: keyof typeof INSERT_AUTOMATION_FIELDS) =>
      INSERT_AUTOMATION_FIELDS[kind].map((r) => r.target);
    expect(fields('compressor')).not.toContain('attack');
    expect(fields('compressor')).not.toContain('ratio');
    expect(fields('compressor')).not.toContain('release');
    expect(fields('tape')).not.toContain('seed');
    expect(fields('advanced-drive')).not.toContain('division');
    for (const kind of INSERT_KIND_NAMES) expect(fields(kind)).not.toContain('enabled');
  });

  it('spells a nested field with its index', () => {
    expect(INSERT_AUTOMATION_FIELDS.eq.map((r) => r.target)).toContain('bands.7.q');
    expect(INSERT_AUTOMATION_FIELDS['advanced-drive'].map((r) => r.target)).toContain(
      'stages.2.lfoCutoff',
    );
  });
});
