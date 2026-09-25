/**
 * The insert kinds are code-owned and a strip's list is bounded (#641): an
 * unknown kind is dangling, never invented, and a list past `MAX_INSERTS`
 * is cut with a correction, so a song cannot allocate DSP a table here did
 * not declare.
 */
import { describe, expect, it } from 'vitest';

import { FieldNormaliser } from '../song/arrangementFields';
import { DEFAULT_CHORUS } from './chorusInsert';
import { DEFAULT_DRIVE } from './driveInsert';
import { MAX_INSERTS } from './insertConstants';
import { INSERT_KINDS, INSERT_KIND_NAMES, insertKind, normaliseInserts } from './insertRegistry';

const PATH = 'parts[0].strip.inserts';

function normalise(raw: unknown): { specs: unknown[]; n: FieldNormaliser } {
  const n = new FieldNormaliser();
  return { specs: normaliseInserts(raw, PATH, n), n };
}

describe('INSERT_KINDS', () => {
  it('names every shipped kind, each with its fields, defaults, normaliser and factory', () => {
    expect(INSERT_KIND_NAMES).toEqual([
      'drive',
      'chorus',
      'compressor',
      'retro-reverb',
      'phaser',
      'delay',
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
