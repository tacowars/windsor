/**
 * The part list through `makeArrangement` (#597; version 3 since #705): any sequencer kind
 * on any slot, slot identity and its corrections, the eight-part cap, the
 * version gate, and a song of inert `none` parts. The rest of the normaliser's
 * contract is `arrangementDocument.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { Arrangement } from './arrangement';
import type { ArrangementDocument } from './arrangementDocument';
import { isShippable, makeArrangement } from './arrangementDocument';
import { ArrangementPlayer, type PlayablePart } from './arrangementPlayer';
import { TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import {
  ARRANGEMENT_VERSION,
  DEFAULT_BARS,
  LOW_CUT_MAX_HZ,
  LOW_CUT_MIN_HZ,
} from '../audioConstants';
import { DEFAULT_DRIVE } from '../inserts/driveInsert';
import { DEFAULT_CHORUS } from '../inserts/chorusInsert';

const silentPart = (): PlayablePart => ({
  noteOn: () => 0,
  noteOffByNote: () => {},
  trigger: () => 0,
  setPatch: () => {},
  allNotesOff: () => {},
});

/** Building and running the player is the "usable" proof: no constructor throws. */
function play(arrangement: Arrangement): void {
  const parts = new Map(arrangement.parts.map((p) => [p.slot, silentPart()]));
  const transport = new TickTransport();
  const patches = (arrangement as ArrangementDocument).patches ?? {};
  const player = new ArrangementPlayer(transport, parts, arrangement, patches);
  for (let i = 0; i < TICKS_PER_BAR; i++) transport.advance(0);
  player.dispose();
}

/** The library ids these cases name, embedded as `{}` (#562). */
const PATCHES = { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} };

/** The whole default-length song (#705): the one ∞ region every part here is live in. */
const ALL = [{ start: 0, duration: DEFAULT_BARS * TICKS_PER_BAR }];

/** A current-version document; every part that is an object and names no regions lives the whole song. */
const song = (parts: unknown[], rest: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: ARRANGEMENT_VERSION,
  patches: PATCHES,
  parts: parts.map((part) =>
    typeof part === 'object' && part !== null && !('regions' in part)
      ? { regions: ALL, ...part }
      : part,
  ),
  ...rest,
});

const KICK = { slot: 0, name: 'kick', preset: 'kick', sequencer: { kind: 'euclidean', seed: 0 } };

describe('the part list (#597)', () => {
  it('normalises any kind on any slot: four grid lines', () => {
    const grids = [0, 1, 2, 3].map((slot) => ({
      slot,
      name: `grid ${slot}`,
      preset: 'saw-arp',
      sequencer: { kind: 'grid', seed: slot },
    }));
    const result = makeArrangement(song(grids));
    expect(result.corrections).toEqual([]);
    expect(result.document.parts.map((p) => [p.slot, p.sequencer.kind])).toEqual([
      [0, 'grid'],
      [1, 'grid'],
      [2, 'grid'],
      [3, 'grid'],
    ]);
    expect(isShippable(result)).toBe(true);
  });

  it('normalises three Euclidean parts and one chord part, in list order', () => {
    const result = makeArrangement(
      song([
        { slot: 5, preset: 'kick', sequencer: { kind: 'euclidean', note: 36, seed: 5 } },
        { slot: 2, preset: 'hat', sequencer: { kind: 'euclidean', note: 42, seed: 2 } },
        { slot: 7, preset: 'hat', sequencer: { kind: 'euclidean', note: 46, seed: 7 } },
        { slot: 0, preset: 'drone-sqr', sequencer: { kind: 'chord' } },
      ]),
    );
    expect(result.corrections).toEqual([]);
    expect(result.document.parts.map((p) => p.slot)).toEqual([5, 2, 7, 0]);
    expect(() => play(result.document)).not.toThrow();
  });

  it('drops a later part on a slot already used, reported', () => {
    const result = makeArrangement(
      song([
        KICK,
        { slot: 0, name: 'hat', preset: 'hat', sequencer: { kind: 'euclidean', seed: 0 } },
      ]),
    );
    expect(result.document.parts.map((p) => p.name)).toEqual(['kick']);
    expect(result.corrections).toContain('parts[1]: slot 0 is already used — part dropped');
  });

  it('drops a part with no slot or one out of range: identity has no default', () => {
    const result = makeArrangement(
      song([KICK, { preset: 'hat' }, { slot: 8, preset: 'hat' }, { slot: 1.5, preset: 'hat' }]),
    );
    expect(result.document.parts.map((p) => p.slot)).toEqual([0]);
    expect(result.corrections).toEqual([
      'parts[1].slot: undefined is not a slot 0–7 — part dropped',
      'parts[2].slot: 8 is not a slot 0–7 — part dropped',
      'parts[3].slot: 1.5 is not a slot 0–7 — part dropped',
    ]);
  });

  it('keeps at most eight parts', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ slot: i % 8, preset: 'kick' }));
    const result = makeArrangement(song(nine));
    expect(result.document.parts).toHaveLength(8);
    expect(result.corrections[0]).toBe('parts: 9 parts — only the first 8 are kept');
  });

  it('corrects a name that is not a string to "Part n"', () => {
    const result = makeArrangement(song([{ ...KICK, slot: 2, name: 7 }]));
    expect(result.document.parts[0]?.name).toBe('Part 3');
    expect(result.corrections).toEqual(['parts[0].name: 7 is not a name — using "Part 3"']);
  });

  it('normalises a part strip over DEFAULT_STRIP', () => {
    const result = makeArrangement(
      song([{ ...KICK, strip: { level: 9, pan: -0.5, sends: { a: 0.4 } } }]),
    );
    expect(result.document.parts[0]?.strip).toEqual({
      level: 4,
      pan: -0.5,
      lowCut: LOW_CUT_MIN_HZ,
      sends: { a: 0.4 },
      inserts: [],
    });
    expect(result.corrections).toEqual(['parts[0].strip.level: clamped 9 to 4']);
  });

  it('keeps a strip low cut in range, and rests at the floor when the strip names none (#640)', () => {
    const cutOf = (lowCut: unknown): { cut: number | undefined; corrections: string[] } => {
      const result = makeArrangement(song([{ ...KICK, strip: { lowCut } }]));
      return { cut: result.document.parts[0]?.strip.lowCut, corrections: result.corrections };
    };
    expect(cutOf(undefined)).toEqual({ cut: LOW_CUT_MIN_HZ, corrections: [] });
    expect(cutOf(120)).toEqual({ cut: 120, corrections: [] });
    expect(cutOf(LOW_CUT_MAX_HZ * 2).cut).toBe(LOW_CUT_MAX_HZ);
    expect(cutOf(1).cut).toBe(LOW_CUT_MIN_HZ);
    const junk = cutOf('low');
    expect(junk.cut).toBe(LOW_CUT_MIN_HZ);
    expect(junk.corrections).toEqual([
      `parts[0].strip.lowCut: "low" is not a number — using ${LOW_CUT_MIN_HZ}`,
    ]);
  });

  it('carries strip inserts through export and import, and an unknown kind fails the gate (#641)', () => {
    const inserts = [
      { ...DEFAULT_DRIVE, drive: 20, mix: 0.6 },
      { ...DEFAULT_CHORUS, rate: 1.2, spread: 1 },
    ];
    const first = makeArrangement(song([{ ...KICK, strip: { inserts } }]));
    expect(first.document.parts[0]?.strip.inserts).toEqual(inserts);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.document.parts[0]?.strip.inserts).toEqual(inserts);
    expect(again.corrections).toEqual([]);

    const unknown = makeArrangement(song([{ ...KICK, strip: { inserts: [{ kind: 'fuzz' }] } }]));
    expect(unknown.document.parts[0]?.strip.inserts).toEqual([]);
    expect(unknown.dangling).toEqual([
      'parts[0].strip.inserts[0].kind: no insert kind "fuzz" is defined',
    ]);
    expect(isShippable(unknown)).toBe(false);
  });

  it('round-trips a strip low cut through export and import (#640)', () => {
    const first = makeArrangement(song([{ ...KICK, strip: { lowCut: 150 } }]));
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.document.parts[0]?.strip.lowCut).toBe(150);
    expect(again.corrections).toEqual([]);
  });

  it('round-trips mute and solo, and leaves an absent one absent (windsor#154)', () => {
    const first = makeArrangement(song([{ ...KICK, strip: { mute: true, solo: true } }]));
    expect(first.document.parts[0]?.strip).toMatchObject({ mute: true, solo: true });
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.document.parts[0]?.strip).toEqual(first.document.parts[0]?.strip);
    expect(again.corrections).toEqual([]);

    const absent = makeArrangement(song([{ ...KICK, strip: { level: 1 } }]));
    expect(absent.document.parts[0]?.strip).not.toHaveProperty('mute');
    expect(absent.document.parts[0]?.strip).not.toHaveProperty('solo');
  });

  it('keeps an explicit false mute and solo through export and import, as output keeps master', () => {
    const first = makeArrangement(song([{ ...KICK, strip: { mute: false, solo: false } }]));
    expect(first.document.parts[0]?.strip).toMatchObject({ mute: false, solo: false });
    expect(first.corrections).toEqual([]);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.document).toEqual(first.document);
    expect(again.corrections).toEqual([]);
  });

  it('normalises a corrected mute and solo to the same document a second time', () => {
    const first = makeArrangement(song([{ ...KICK, strip: { mute: null, solo: 'on' } }]));
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.document).toEqual(first.document);
    expect(again.corrections).toEqual([]);
  });

  it('corrects a mute that is not a boolean to an explicit false, the default undo reads back', () => {
    const result = makeArrangement(song([{ ...KICK, strip: { mute: null, solo: 'on' } }]));
    expect(result.document.parts[0]?.strip).toMatchObject({ mute: false, solo: false });
    expect(result.corrections).toEqual([
      'parts[0].strip.mute: null is not a boolean — using false',
      'parts[0].strip.solo: "on" is not a boolean — using false',
    ]);
  });

  it('is unusable when the version is not 4', () => {
    for (const version of [undefined, 1, 2, '4', 5]) {
      const result = makeArrangement({ ...song([KICK]), version });
      expect(result.usable, String(version)).toBe(false);
      expect(result.corrections[0]).toMatch(/^version: /);
    }
  });

  it('is usable with only none parts, and not shippable', () => {
    const result = makeArrangement(
      song([{ slot: 0, preset: 'kick', sequencer: { kind: 'none' } }]),
    );
    expect(result.usable).toBe(true);
    expect(isShippable(result)).toBe(false);
    expect(() => play(result.document)).not.toThrow();
  });
});
