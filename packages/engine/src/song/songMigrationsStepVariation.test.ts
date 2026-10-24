/**
 * Song version 18 → 19 (windsor#935, record `2026-10-24-step-variation`):
 * step variation replaced Skip on the Grid and the Arp, so a version-18
 * song loses their `skipChance`, on the part and on a region's own pattern,
 * and their `seq.skipChance` lanes, and loads at this build's version with
 * no correction. The Figure keeps its Skip. A current song round-trips the
 * four new fields.
 */
import { describe, expect, it } from 'vitest';

import { ARRANGEMENT_VERSION } from '../audioConstants';
import { song } from '../__fixtures__/documentCases';
import { makeArrangement } from './arrangementDocument';
import { upgradeSong } from './songMigrations';

type Doc = Record<string, unknown>;

const BAR = 96;
const lane = (target: string): Doc => ({
  target,
  on: true,
  points: [{ tick: 0, value: 0.5, bend: 0 }],
});
const grid = (over: Doc = {}): Doc => ({ kind: 'grid', seed: 3, skipChance: 0.4, ...over });

/** A version-18 song: a Grid with a skip, its lane and a region pattern's skip; an Arp; a Figure. */
const versionEighteen = (): Doc => ({
  ...song([
    {
      slot: 0,
      name: 'grid',
      preset: 'saw-arp',
      regions: [
        { start: 0, duration: BAR },
        { start: BAR, duration: BAR, pattern: { kind: 'grid', skipChance: 0.7 } },
      ],
      sequencer: grid(),
      automation: [lane('seq.skipChance'), lane('strip.level')],
    },
    {
      slot: 1,
      name: 'arp',
      preset: 'saw-arp',
      sequencer: { kind: 'arp', seed: 4, skipChance: 0.2 },
      automation: [lane('seq.gate'), lane('seq.skipChance')],
    },
    {
      slot: 2,
      name: 'figure',
      preset: 'drone-sqr',
      sequencer: { kind: 'figure', seed: 5, skipChance: 0.3 },
      automation: [lane('seq.skipChance')],
    },
  ]),
  version: 18,
});

type Part = { sequencer: Doc; regions: Doc[]; automation?: Doc[] };
const partsOf = (doc: unknown): Part[] => (doc as { parts: Part[] }).parts;

describe('a version-18 song (windsor#935)', () => {
  it('loses the Grid’s and the Arp’s skipChance and Skip lanes, the Figure’s kept', () => {
    const raw = versionEighteen();
    const before = structuredClone(raw);
    const { document, refused } = upgradeSong(raw);
    expect(refused).toBeUndefined();
    expect(raw).toEqual(before);
    const [g, a, f] = partsOf(document);
    expect(g!.sequencer).toEqual({ kind: 'grid', seed: 3 });
    expect(g!.regions[1]!.pattern).toEqual({ kind: 'grid' });
    expect(g!.automation).toEqual([lane('strip.level')]);
    expect(a!.sequencer).toEqual({ kind: 'arp', seed: 4 });
    expect(a!.automation).toEqual([lane('seq.gate')]);
    expect(f!.sequencer).toEqual({ kind: 'figure', seed: 5, skipChance: 0.3 });
    expect(f!.automation).toEqual([lane('seq.skipChance')]);
  });

  it("loads at this build's version with no correction, nothing varied", () => {
    const result = makeArrangement(versionEighteen());
    expect(result.refused).toBeUndefined();
    expect(result.corrections).toEqual([]);
    expect(result.document.version).toBe(ARRANGEMENT_VERSION);
    const [g, a] = result.document.parts;
    for (const sequencer of [g!.sequencer, a!.sequencer]) {
      expect(sequencer).not.toHaveProperty('skipChance');
      expect(sequencer).toMatchObject({
        randomness: 0,
        probability: 0,
        restsSound: false,
        octaveMode: false,
      });
    }
    expect(g!.regions[1]!.pattern).not.toHaveProperty('skipChance');
  });

  it('round-trips the four fields at this version', () => {
    const variation = { randomness: 0.4, probability: 0.8, restsSound: true, octaveMode: true };
    const raw = song([
      {
        slot: 0,
        name: 'grid',
        preset: 'saw-arp',
        sequencer: { kind: 'grid', seed: 1, ...variation },
      },
      {
        slot: 1,
        name: 'arp',
        preset: 'saw-arp',
        sequencer: { kind: 'arp', seed: 2, ...variation },
      },
    ]);
    const once = makeArrangement(raw);
    expect(once.corrections).toEqual([]);
    const twice = makeArrangement(JSON.parse(JSON.stringify(once.document)));
    expect(twice.corrections).toEqual([]);
    expect(twice.document).toEqual(once.document);
    for (const part of twice.document.parts) expect(part.sequencer).toMatchObject(variation);
  });
});
