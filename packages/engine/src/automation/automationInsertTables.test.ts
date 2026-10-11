import { describe, expect, it } from 'vitest';
import { INSERT_KINDS, INSERT_KIND_NAMES } from '../inserts/insertRegistry';
import { insertKindFields } from './automationInsertFields';
import { INSERT_AUTOMATION_FIELDS, slotRows } from './automationInsertTables';

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
      const rows = INSERT_AUTOMATION_FIELDS[kind];
      // A host's slot rows repeat a target once per child kind.
      const keys = rows.map((r) => `${r.childKind ?? kind}:${r.target}`);
      expect(new Set(keys).size, kind).toBe(rows.length);
      for (const row of rows) {
        // A slot row is its child kind's field, read on that kind's defaults.
        if (row.scale === 'switch') continue;
        const defaults = INSERT_KINDS[row.childKind ?? kind].defaults;
        const value = at(defaults, row.target.replace(/^slot\./, ''));
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

  it("gives each host, Echo and Bloom, every other kind's rows and switch under slot., labelled Slot", () => {
    const echoOwn = INSERT_AUTOMATION_FIELDS.echo.filter((r) => !r.childKind);
    expect(echoOwn.map((r) => r.target)).toEqual([
      'delayTime',
      'feedback',
      'damp',
      'resonance',
      'mix',
    ]);
    const hosts = ['echo', 'bloom'] as const;
    for (const host of hosts) {
      const own = INSERT_AUTOMATION_FIELDS[host].filter((r) => !r.childKind);
      expect(INSERT_AUTOMATION_FIELDS[host].slice(0, own.length)).toEqual(own);
      expect(slotRows(host)).toHaveLength(INSERT_AUTOMATION_FIELDS[host].length - own.length);
      for (const kind of INSERT_KIND_NAMES) {
        const slot = slotRows(host).filter((r) => r.childKind === kind);
        if (kind === host) {
          expect(slot).toEqual([]);
          continue;
        }
        // A child's own slot is none (record `2026-10-11-wet-path-slot` decision 2): its own rows only.
        const child = insertKindFields(kind).filter((r) => !r.childKind);
        expect(slot.map((r) => r.target)).toEqual(child.map((r) => `slot.${r.target}`));
        expect(slot.map((r) => r.label)).toEqual(child.map((r) => `Slot ${r.label}`));
        slot.forEach((r, i) => {
          expect(r).toMatchObject({ min: child[i]!.min, max: child[i]!.max });
          expect(r.scale).toBe(child[i]!.scale);
        });
      }
    }
    // Only the hosts' own rows sit in the plain tables of the other kinds.
    for (const kind of INSERT_KIND_NAMES.filter((k) => !(hosts as readonly string[]).includes(k))) {
      expect(INSERT_AUTOMATION_FIELDS[kind].some((r) => r.childKind)).toBe(false);
    }
  });

  it('spells a nested field with its index', () => {
    expect(INSERT_AUTOMATION_FIELDS.eq.map((r) => r.target)).toContain('bands.7.q');
    expect(INSERT_AUTOMATION_FIELDS['advanced-drive'].map((r) => r.target)).toContain(
      'stages.2.lfoCutoff',
    );
  });
});
