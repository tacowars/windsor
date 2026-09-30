/**
 * Insert ids in a song (windsor#186): every insert on a part's strip, the
 * master and both send buses has one once the song is normalised. Ids
 * round-trip unchanged through export and import, a song written without
 * them (a v4 one, or a v3 one through its upgrade) fills them silently and
 * the same way every time, and a duplicate or a bad id is corrected.
 */
import { describe, expect, it } from 'vitest';

import { ARRANGEMENT_VERSION } from '../audioConstants';
import { FULL_ARRANGEMENT } from '../__fixtures__/fullArrangement';
import { insertIdsOf } from '../__fixtures__/insertIds';
import { DEFAULT_ADVANCED_DRIVE } from '../inserts/advancedDriveSpec';
import { DEFAULT_CHORUS } from '../inserts/chorusInsert';
import { DEFAULT_DRIVE } from '../inserts/driveInsert';
import { DEFAULT_ECHO } from '../inserts/echoInsert';
import { isInsertId } from '../inserts/insertIds';
import { DEFAULT_PLATE_REVERB } from '../inserts/plateReverbInsert';
import { SPACES } from '../mixer/reverbSpace';
import { makeArrangement } from './arrangementDocument';

const PATCHES = { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} };
const TWO_DRIVES = [
  { ...DEFAULT_ADVANCED_DRIVE, drive: 3 },
  { ...DEFAULT_ADVANCED_DRIVE, drive: 9 },
];

/** A song with a chain in every place a chain goes: a part, the master, Send A and Send B. */
function everyChain(chain: (at: string) => unknown[]): Record<string, unknown> {
  return {
    ...FULL_ARRANGEMENT,
    version: ARRANGEMENT_VERSION,
    patches: PATCHES,
    parts: FULL_ARRANGEMENT.parts.map((part, i) =>
      i === 0 ? { ...part, strip: { inserts: chain('part') } } : part,
    ),
    master: { inserts: chain('master') },
    returns: { a: { level: 0.9, inserts: chain('a') }, b: { level: 0.6, inserts: chain('b') } },
  };
}

const CHAINS = [
  'parts[0].strip.inserts',
  'master.inserts',
  'returns.a.inserts',
  'returns.b.inserts',
];

describe('insert ids in a song', () => {
  it('round-trips the ids a song holds, unchanged, in every chain', () => {
    const raw = everyChain((at) => [
      { ...TWO_DRIVES[0], id: `${at}-one` },
      { ...TWO_DRIVES[1], id: `${at}-two` },
    ]);
    const first = makeArrangement(raw);
    expect(first.corrections).toEqual([]);
    const ids = insertIdsOf(first.document);
    expect(ids['parts[0].strip.inserts']).toEqual(['part-one', 'part-two']);
    expect(ids['master.inserts']).toEqual(['master-one', 'master-two']);
    expect(ids['returns.a.inserts']).toEqual(['a-one', 'a-two']);
    expect(ids['returns.b.inserts']).toEqual(['b-one', 'b-two']);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });

  it('fills every chain of a song without ids, silently, and the same way every time', () => {
    const raw = everyChain(() => TWO_DRIVES);
    const first = makeArrangement(raw);
    expect(first.corrections).toEqual([]);
    const ids = insertIdsOf(first.document);
    for (const chain of CHAINS) {
      expect(ids[chain], chain).toHaveLength(2);
      expect(ids[chain]!.every(isInsertId), chain).toBe(true);
      expect(new Set(ids[chain]).size, chain).toBe(2);
    }
    expect(makeArrangement(structuredClone(raw)).document).toEqual(first.document);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });

  it('corrects a duplicate and a bad id in any chain, keeping the first holder', () => {
    const raw = everyChain(() => [
      { ...DEFAULT_DRIVE, id: 'same' },
      { ...DEFAULT_CHORUS, id: 'same' },
      { ...DEFAULT_DRIVE, id: 42 },
    ]);
    const result = makeArrangement(raw);
    const ids = insertIdsOf(result.document);
    for (const chain of CHAINS) {
      expect(ids[chain]![0], chain).toBe('same');
      expect(new Set(ids[chain]).size, chain).toBe(3);
      expect(ids[chain]!.every(isInsertId), chain).toBe(true);
    }
    expect([...result.corrections].sort()).toEqual(
      CHAINS.flatMap((chain) => [
        `${chain}[1].id: "same" is already in this chain — a new one`,
        `${chain}[2].id: 42 is not an id — a new one`,
      ]).sort(),
    );
  });

  it('gives the inserts of a v3 song ids once upgraded and normalised, with no correction', () => {
    const v3 = {
      ...FULL_ARRANGEMENT,
      version: 3,
      patches: PATCHES,
      parts: FULL_ARRANGEMENT.parts.map((part, i) =>
        i === 0 ? { ...part, strip: { inserts: TWO_DRIVES } } : part,
      ),
      master: { inserts: [DEFAULT_DRIVE] },
      returns: {
        room: { kind: 'reverb', level: 0.5, space: SPACES.cathedral },
        echo: { kind: 'delay', level: 0.4, delayTime: 0.375 },
      },
    };
    const result = makeArrangement(v3);
    expect(result.corrections).toEqual([]);
    expect(result.document.version).toBe(ARRANGEMENT_VERSION);
    const ids = Object.fromEntries(
      Object.entries(insertIdsOf(result.document)).filter(([, chain]) => chain.length > 0),
    );
    expect(Object.keys(ids).sort()).toEqual([...CHAINS].sort());
    for (const ofChain of Object.values(ids)) expect(ofChain.every(isInsertId)).toBe(true);
    expect(result.document.returns?.a?.inserts[0]?.kind).toBe(DEFAULT_PLATE_REVERB.kind);
    expect(result.document.returns?.b?.inserts[0]?.kind).toBe(DEFAULT_ECHO.kind);
    expect(makeArrangement(structuredClone(v3)).document).toEqual(result.document);
  });

  it('gives a send bus that names only its level the default chain, with its ids', () => {
    const result = makeArrangement({ ...everyChain(() => []), returns: { a: { level: 0.5 } } });
    const [plate] = result.document.returns?.a?.inserts ?? [];
    expect(isInsertId(plate?.id)).toBe(true);
    expect(result.corrections).toEqual([]);
  });
});
