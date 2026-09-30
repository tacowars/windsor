/**
 * The insert id generator (windsor#186): one source for every id,
 * deterministic when seeded, never handing out an id its chain holds; and
 * the fill normalising gives a chain, pure so a document reads back the same.
 */
import { describe, expect, it } from 'vitest';

import { FieldNormaliser } from '../song/arrangementFields';
import { DEFAULT_CHORUS } from './chorusInsert';
import { DEFAULT_DRIVE } from './driveInsert';
import { INSERT_ID_ALPHABET, INSERT_ID_LENGTH } from './insertIdConstants';
import {
  chainIds,
  createInsertIdSource,
  freshInsertId,
  isInsertId,
  seedFromText,
  withInsertIds,
} from './insertIds';
import { normaliseInserts } from './insertRegistry';

const SHAPE = new RegExp(`^[${INSERT_ID_ALPHABET}]{${INSERT_ID_LENGTH}}$`);

describe('createInsertIdSource', () => {
  it('draws the same ids from the same seed, and others from another', () => {
    const draw = (seed: number): string[] => {
      const source = createInsertIdSource(seed);
      return [source.next(), source.next(), source.next()];
    };
    expect(draw(186)).toEqual(draw(186));
    expect(draw(186)).not.toEqual(draw(187));
    for (const id of draw(186)) expect(id).toMatch(SHAPE);
  });

  it('never hands out an id the chain holds', () => {
    const first = createInsertIdSource(5).next();
    const source = createInsertIdSource(5);
    const next = source.next([first]);
    expect(next).not.toBe(first);
    expect(next).toMatch(SHAPE);
  });

  it('seeds at random without a seed', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createInsertIdSource().next()));
    expect(ids.size).toBe(50);
    const fresh = new Set(Array.from({ length: 50 }, () => freshInsertId()));
    expect(fresh.size).toBe(50);
    expect(freshInsertId(['a', 'b'])).toMatch(SHAPE);
  });
});

describe('isInsertId and seedFromText', () => {
  it('takes a non-empty string as an id and nothing else', () => {
    expect(isInsertId('a')).toBe(true);
    for (const junk of ['', null, undefined, 3, {}, ['a']]) expect(isInsertId(junk)).toBe(false);
  });

  it('hashes text to a 32-bit seed, the same every time', () => {
    expect(seedFromText('drive,chorus')).toBe(seedFromText('drive,chorus'));
    expect(seedFromText('drive,chorus')).not.toBe(seedFromText('chorus,drive'));
    expect(seedFromText('')).toBeGreaterThanOrEqual(0);
    expect(seedFromText('x')).toBeLessThan(2 ** 32);
  });
});

describe('chainIds', () => {
  const claim = (
    raw: unknown,
    kind = 'drive',
    at = 'x',
  ): { raw: unknown; at: string; kind: string } => ({
    raw,
    at,
    kind,
  });

  it('fills from the chain kinds, so a settings edit keeps the id it fills', () => {
    const n = new FieldNormaliser();
    const ids = chainIds([claim(undefined), claim(undefined, 'chorus')], n);
    expect(chainIds([claim(undefined), claim(undefined, 'chorus')], n)).toEqual(ids);
    expect(chainIds([claim(undefined, 'chorus'), claim(undefined)], n)).not.toEqual(ids);
    expect(n.corrections).toEqual([]);
  });
});

describe('withInsertIds', () => {
  it('gives a list the ids normalising gives it, and keeps the specs that have one', () => {
    const list = [DEFAULT_DRIVE, { ...DEFAULT_CHORUS, id: 'kept' }];
    const filled = withInsertIds(list);
    expect(filled).toEqual(normaliseInserts(list, 'returns.a.inserts', new FieldNormaliser()));
    expect(filled[1]).toBe(list[1]);
    expect(withInsertIds(filled)).toEqual(filled);
    // A knob edit to the code's chain fills the same id.
    expect(withInsertIds([{ ...DEFAULT_DRIVE, mix: 0.1 }, list[1]!])[0]!.id).toBe(filled[0]!.id);
  });
});
