/**
 * The 3 → 4 upgrade outputs exactly what the v3 normaliser kept, renamed, and
 * nothing a v3 load dropped (windsor#172). The oracle is the v3 normaliser's
 * accepted keys, restated from `song/deskNormalise.ts` as it stood before the
 * send buses: returns `room` (`kind`, `level`, `space` with the plate's
 * fields) and `echo` (`kind`, `level`, `delayTime`, `feedback`, `damp`,
 * `resonance`), and strip sends `room` and `echo`.
 */
import { describe, expect, it } from 'vitest';

import { REVERB_SPACE_RANGES } from '../audioConstants';
import { KICK, song } from '../__fixtures__/documentCases';
import { RETURNS } from '../mixer/mix';
import { SPACES } from '../mixer/reverbSpace';
import { makeArrangement } from './arrangementDocument';
import { upgradeSong } from './songMigrations';

type Doc = Record<string, unknown>;

const V3_RETURN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  room: ['kind', 'level', 'space'],
  echo: ['kind', 'level', 'delayTime', 'feedback', 'damp', 'resonance'],
};
const V3_SPACE_FIELDS = Object.keys(REVERB_SPACE_RANGES);
const V3_SENDS = ['room', 'echo'];

const isRecord = (value: unknown): value is Doc =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const keep = (from: Doc, keys: readonly string[]): Doc =>
  Object.fromEntries(Object.entries(from).filter(([key]) => keys.includes(key)));

/** A v3 return with only the fields the v3 normaliser read. */
function v3Return(name: string, raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const out = keep(raw, V3_RETURN_FIELDS[name] ?? []);
  if (isRecord(out.space)) out.space = keep(out.space, V3_SPACE_FIELDS);
  return out;
}

/** A v3 document with everything the v3 normaliser dropped removed: the oracle. */
function v3Kept(doc: Doc): Doc {
  const out: Doc = { ...doc };
  if (isRecord(doc.returns)) {
    const returns = keep(doc.returns, Object.keys(V3_RETURN_FIELDS));
    out.returns = Object.fromEntries(
      Object.entries(returns).map(([name, raw]) => [name, v3Return(name, raw)]),
    );
  }
  out.parts = (doc.parts as Doc[]).map((part) => {
    const strip = part.strip as Doc;
    return { ...part, strip: { ...strip, sends: keep(strip.sends as Doc, V3_SENDS) } };
  });
  return out;
}

const ROOM = { kind: 'reverb', level: 0.5, space: { ...SPACES.cathedral, size: 2 } };
const ECHO = { kind: 'delay', level: 0.4, delayTime: 0.375, feedback: 0.5, damp: 2400 };
const v3 = (returns: Doc, sends: Doc = { room: 0.25, echo: 1 }): Doc => ({
  ...song([{ ...KICK, strip: { level: 0.8, sends } }], { returns }),
  version: 3,
});

describe('the 3 → 4 upgrade carries only what v3 kept', () => {
  it('drops a lone v3 returns.a: the migrated room send plays the default Send A', () => {
    const result = makeArrangement(v3({ a: { level: 0 } }));
    expect(result.corrections).toEqual([]);
    expect(result.document.returns).toBeUndefined();
    expect(result.document.parts[0]?.strip.sends).toEqual({ a: 0.25, b: 1 });
  });

  it('drops a lone v3 returns.b: the migrated echo send plays the default Send B', () => {
    const result = makeArrangement(v3({ b: { level: 0, inserts: [] } }));
    expect(result.corrections).toEqual([]);
    expect(result.document.returns).toBeUndefined();
  });

  it('lets room win over a v3 returns.a, whichever comes first', () => {
    const expected = makeArrangement(v3({ room: ROOM })).document.returns;
    for (const returns of [
      { a: { level: 0 }, room: ROOM },
      { room: ROOM, a: { level: 0 } },
    ]) {
      expect(makeArrangement(v3(returns)).document.returns).toEqual(expected);
    }
  });

  it('lets echo win over a v3 returns.b, whichever comes first', () => {
    const expected = makeArrangement(v3({ echo: ECHO })).document.returns;
    for (const returns of [
      { b: { inserts: [] }, echo: ECHO },
      { echo: ECHO, b: { inserts: [] } },
    ]) {
      expect(makeArrangement(v3(returns)).document.returns).toEqual(expected);
    }
  });

  it('upgrades a v3 file full of junk and colliding keys to what the v3 normaliser kept', () => {
    const junk = v3(
      {
        a: { level: 0 },
        b: { level: 0, inserts: [] },
        cave: { level: 1 },
        room: {
          ...ROOM,
          inserts: [],
          mix: 0,
          bogus: 1,
          space: { ...ROOM.space, kind: 'echo', mix: 0 },
        },
        echo: { ...ECHO, inserts: [], mix: 0, kind: 'reverb', space: {} },
      },
      { a: 1, b: 0.1, room: 0.25, echo: 0.5, hall: 0.3 },
    );
    const oracle = v3Kept(junk);
    expect(upgradeSong(junk).document).toEqual(upgradeSong(oracle).document);
    const result = makeArrangement(junk);
    expect(result.dangling).toEqual([]);
    expect(result.document).toEqual(makeArrangement(oracle).document);
    expect(result.document.returns?.['a']?.level).toBe(0.5);
    expect(result.document.returns?.['b']?.level).toBe(0.4);
    expect(result.document.returns?.['a']).not.toEqual(RETURNS.a);
    expect(result.document.parts[0]?.strip.sends).toEqual({ a: 0.25, b: 0.5 });
  });
});
