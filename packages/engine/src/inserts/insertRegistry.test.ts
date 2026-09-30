/**
 * The insert kinds are code-owned and a strip's list is bounded (#641): an
 * unknown kind is dangling, never invented, and a list past `MAX_INSERTS`
 * is cut with a correction, so a song cannot allocate DSP a table here did
 * not declare.
 */
import { describe, expect, it } from 'vitest';

import { withoutInsertIds } from '../__fixtures__/insertIds';
import { FieldNormaliser } from '../song/arrangementFields';
import { DEFAULT_CHORUS } from './chorusInsert';
import { DEFAULT_DRIVE } from './driveInsert';
import { DEFAULT_ADVANCED_DRIVE } from './advancedDriveSpec';
import { MAX_INSERTS } from './insertConstants';
import { isInsertId } from './insertIds';
import { INSERT_KINDS, INSERT_KIND_NAMES, insertKind, normaliseInserts } from './insertRegistry';

const PATH = 'parts[0].strip.inserts';

/** The list normalised, its ids apart: `specs` is each entry's settings, `ids` its id. */
function normalise(raw: unknown): { specs: unknown[]; ids: unknown[]; n: FieldNormaliser } {
  const n = new FieldNormaliser();
  const full = normaliseInserts(raw, PATH, n);
  return {
    specs: withoutInsertIds(full),
    ids: full.map((spec) => spec.id),
    n,
  };
}

describe('INSERT_KINDS', () => {
  it('names every shipped kind, each with its fields, defaults, normaliser and factory', () => {
    expect(INSERT_KIND_NAMES).toEqual([
      'drive',
      'advanced-drive',
      'chorus',
      'compressor',
      'retro-reverb',
      'phaser',
      'delay',
      'ensemble',
      'tape',
      'plate',
      'echo',
    ]);
    for (const name of INSERT_KIND_NAMES) {
      const kind = INSERT_KINDS[name];
      expect(kind.defaults.kind, name).toBe(name);
      expect(kind.fields, name).toContain('kind');
      expect(Object.keys(kind.defaults).sort(), name).toEqual([...kind.fields].sort());
      expect(kind.normalise({ ...kind.defaults }, 'x', new FieldNormaliser()), name).toEqual(
        kind.defaults,
      );
    }
  });

  it('looks a kind up by own name only', () => {
    expect(insertKind(INSERT_KINDS, 'drive')).toBe(INSERT_KINDS.drive);
    expect(insertKind(INSERT_KINDS, 'constructor')).toBeUndefined();
    expect(insertKind(INSERT_KINDS, 7)).toBeUndefined();
  });
});

describe('normaliseInserts', () => {
  it('reads an absent list as none, silently', () => {
    const { specs, n } = normalise(undefined);
    expect(specs).toEqual([]);
    expect(n.corrections).toEqual([]);
  });

  it('keeps a mixed list in its order, each entry over its own kind (#642)', () => {
    const { specs, n } = normalise([
      { kind: 'drive', drive: 6 },
      { kind: 'chorus', mix: 0.3 },
    ]);
    expect(specs).toEqual([
      { ...DEFAULT_DRIVE, drive: 6 },
      { ...DEFAULT_CHORUS, mix: 0.3 },
    ]);
    expect(n.corrections).toEqual([]);
  });

  it('fills each entry over its kind defaults', () => {
    expect(normalise([{ kind: 'drive', mix: 0.5 }]).specs).toEqual([
      { ...DEFAULT_DRIVE, mix: 0.5 },
    ]);
  });

  it('reports a list that is not a list, and an entry that is not an object', () => {
    expect(normalise('drive').n.corrections).toEqual([
      `${PATH}: "drive" is not a list — using none`,
    ]);
    const { specs, n } = normalise([3, { kind: 'drive' }]);
    expect(specs).toEqual([DEFAULT_DRIVE]);
    expect(n.corrections).toEqual([`${PATH}[0]: 3 is not an insert — dropped`]);
  });

  it('drops an unknown kind as dangling', () => {
    const { specs, n } = normalise([{ kind: 'fuzz' }, { kind: 'drive' }]);
    expect(specs).toEqual([DEFAULT_DRIVE]);
    expect(n.dangling).toEqual([`${PATH}[0].kind: no insert kind "fuzz" is defined`]);
  });

  it(`keeps the first ${MAX_INSERTS} and reports the rest`, () => {
    const raw = Array.from({ length: MAX_INSERTS + 1 }, () => ({ kind: 'drive' }));
    const { specs, n } = normalise(raw);
    expect(specs).toHaveLength(MAX_INSERTS);
    expect(n.corrections).toEqual([
      `${PATH}[${MAX_INSERTS}]: past the ${MAX_INSERTS}-insert limit — dropped`,
    ]);
  });
});

describe('normaliseInserts: every insert has an id (windsor#186)', () => {
  const STAGE = { ...DEFAULT_ADVANCED_DRIVE, drive: 3 };

  it('keeps valid ids, silently, and a normalised list reads back unchanged', () => {
    const raw = [
      { ...STAGE, id: 'first' },
      { ...STAGE, id: 'second' },
    ];
    const n = new FieldNormaliser();
    const once = normaliseInserts(raw, PATH, n);
    expect(once).toEqual(raw);
    expect(n.corrections).toEqual([]);
    expect(normaliseInserts(JSON.parse(JSON.stringify(once)), PATH, n)).toEqual(once);
    expect(n.corrections).toEqual([]);
  });

  it('fills a missing id silently, the same way every time', () => {
    const { ids, n } = normalise([STAGE, STAGE, { kind: 'drive' }]);
    expect(n.corrections).toEqual([]);
    expect(ids.every(isInsertId)).toBe(true);
    expect(new Set(ids).size).toBe(3);
    expect(normalise([STAGE, STAGE, { kind: 'drive' }]).ids).toEqual(ids);
  });

  it('fills around the ids the chain already holds, never taking one', () => {
    const bare = normalise([STAGE, STAGE]).ids;
    const { ids, n } = normalise([STAGE, { ...STAGE, id: bare[0] }]);
    expect(n.corrections).toEqual([]);
    expect(ids[1]).toBe(bare[0]);
    expect(ids[0]).not.toBe(bare[0]);
  });

  it('replaces a duplicate within the chain, keeping the first, with a correction', () => {
    const { ids, n } = normalise([
      { ...STAGE, id: 'same' },
      { ...STAGE, id: 'same' },
    ]);
    expect(ids[0]).toBe('same');
    expect(isInsertId(ids[1]) && ids[1] !== 'same').toBe(true);
    expect(n.corrections).toEqual([`${PATH}[1].id: "same" is already in this chain — a new one`]);
  });

  it('lets two chains hold the same id', () => {
    const n = new FieldNormaliser();
    expect(normaliseInserts([{ kind: 'drive', id: 'x' }], 'master.inserts', n)[0]!.id).toBe('x');
    expect(normaliseInserts([{ kind: 'drive', id: 'x' }], PATH, n)[0]!.id).toBe('x');
    expect(n.corrections).toEqual([]);
  });

  it('replaces anything that is not a non-empty string, with a correction', () => {
    const junk = [null, '', 7, true, { a: 1 }, ['x']];
    const { ids, n } = normalise(junk.map((id) => ({ kind: 'drive', id })));
    expect(ids.every(isInsertId)).toBe(true);
    expect(new Set(ids).size).toBe(junk.length);
    expect(n.corrections).toEqual(
      junk.map((id, i) => `${PATH}[${i}].id: ${JSON.stringify(id)} is not an id — a new one`),
    );
  });

  it('reads the id beside the kind, never as one of its fields', () => {
    for (const name of INSERT_KIND_NAMES)
      expect(INSERT_KINDS[name].fields, name).not.toContain('id');
    const { specs, n } = normalise([{ kind: 'drive', id: 'x', mix: 0.5 }]);
    expect(specs).toEqual([{ ...DEFAULT_DRIVE, mix: 0.5 }]);
    expect(n.corrections).toEqual([]);
  });
});
