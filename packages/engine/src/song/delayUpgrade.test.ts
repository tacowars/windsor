/**
 * A version-17 song's Dub delays in the version-18 shape (record
 * `2026-10-17-dub-delay-regeneration`, `delayUpgrade.ts`): on every chain, a
 * host's child included, with no correction when the result loads.
 */
import { describe, expect, it } from 'vitest';
import { KICK, song } from '../__fixtures__/documentCases';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { makeArrangement } from './arrangementDocument';
import { upgradeSong } from './songMigrations';

type Doc = Record<string, unknown>;
const OLD = {
  kind: 'delay',
  mode: 'ping-pong',
  leftSync: false,
  rightSync: true,
  leftDivision: '1/8D',
  rightDivision: '1/4',
  leftMs: 420,
  rightMs: 500,
  feedback: 1.1,
  highpass: 4000,
  lowpass: 3600,
  drive: 9,
  mix: 0.4,
  outputDb: -2,
  enabled: true,
};
const NEW = {
  kind: 'delay',
  mode: 'ping-pong',
  leftSync: false,
  leftMs: 420,
  feedback: 1,
  cross: 1,
  lowCut: 1000,
  filter: 'lowpass',
  cutoff: 3600,
  resonance: 0,
  drive: 9,
  damping: 0,
  wow: 0,
  sweep: 0,
  mix: 0.4,
  outputDb: -2,
};

describe("a version-17 song's Dub delays", () => {
  it('moves every delay into the rebuilt loop, on every chain and in a host’s slot', () => {
    const raw: Doc = {
      ...song([{ ...KICK, strip: { inserts: [OLD, { kind: 'eq' }] } }]),
      version: 17,
      groups: [{ id: 'g', inserts: [{ ...OLD, mode: 'stereo' }] }],
      returns: { a: { inserts: [{ kind: 'echo', slot: OLD }] } },
      master: { inserts: [OLD] },
    };
    const { document, refused } = upgradeSong(raw);
    expect(refused).toBeUndefined();
    const doc = document as Doc & {
      parts: { strip: { inserts: Doc[] } }[];
      groups: { inserts: Doc[] }[];
      returns: { a: { inserts: Doc[] } };
      master: { inserts: Doc[] };
    };
    const strip = doc.parts[0]!.strip.inserts;
    expect(strip[0]).toMatchObject(NEW);
    expect(strip[0]).not.toHaveProperty('highpass');
    expect(strip[0]).not.toHaveProperty('lowpass');
    expect(strip[1]).toEqual({ kind: 'eq' });
    expect(doc.groups[0]!.inserts[0]).toMatchObject({ mode: 'stereo', cross: 0 });
    expect(doc.returns.a.inserts[0]!['slot']).toMatchObject(NEW);
    expect(doc.master.inserts[0]).toMatchObject(NEW);
  });

  it('loads the upgraded delay with no correction', () => {
    const raw: Doc = {
      ...song([{ ...KICK, strip: { inserts: [OLD] } }]),
      version: 17,
      master: { inserts: [OLD] },
    };
    const result = makeArrangement(upgradeSong(raw).document);
    expect(result.corrections).toEqual([]);
    expect(result.document.version).toBe(ARRANGEMENT_VERSION);
    expect(result.document.master!.inserts[0]).toMatchObject({ ...NEW, sustain: false });
  });
});
