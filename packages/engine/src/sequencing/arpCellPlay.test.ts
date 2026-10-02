/**
 * How one arp cell plays (windsor#129): the cell index, the gate's
 * look-ahead, the octave shift and its MIDI fallback, the skip draw and its
 * own stream, and what each kind of cell emits over the note held into it.
 * The arpeggiator driving them is `arpeggiatorGrid.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { VOICE_TARGET_PATHS } from '../worklet/fm/voiceTargetTables';
import {
  arpCellIndex,
  arpSkipRng,
  arpSkipSeed,
  holdsToNext,
  playArpCell,
  shiftOctave,
  skipCell,
  strikeCell,
  type ArpCellConfig,
  type ArpOnset,
} from './arpCellPlay';
import { arpNote, defaultArpSteps, type ArpStep } from './arpSteps';
import { hashSeed, streamRng } from './generatorSeed';

const TIE: ArpStep = { kind: 'tie' };
const REST: ArpStep = { kind: 'rest' };
const CONFIG: ArpCellConfig = {
  gate: 0.5,
  divisor: 12,
  accentVelocity: 0.3,
  accentMod: 0.7,
  lanes: [],
};
const onset = (over: Partial<ArpOnset> = {}): ArpOnset => ({
  tick: 24,
  time: 1,
  degree: 0,
  cell: arpNote(),
  index: 0,
  pitch: 60,
  held: null,
  holdsOn: false,
  ...over,
});
const kinds = (o: ReturnType<typeof playArpCell>) => o.events.map((e) => [e.kind, e.note]);

describe('the cell index and the look-ahead', () => {
  it('is the traversal index modulo the cycle, never negative', () => {
    expect([0, 3, 4, 9].map((i) => arpCellIndex(i, 4))).toEqual([0, 3, 0, 1]);
    expect(arpCellIndex(-1, 4)).toBe(3);
  });

  it('holds to the next cell only when it is a tie or a slide, wrapping at the cycle end', () => {
    const steps = defaultArpSteps();
    steps[1] = TIE;
    steps[2] = arpNote({ slide: true });
    steps[3] = arpNote({ accent: true, octave: 1 });
    steps[4] = REST;
    expect([0, 1, 2, 3].map((i) => holdsToNext(steps, i, 5))).toEqual([true, true, false, false]);
    steps[0] = TIE;
    expect(holdsToNext(steps, 4, 5)).toBe(true);
    expect(holdsToNext(steps, 4, 6)).toBe(false);
  });
});

describe('the octave shift', () => {
  it('moves by 12 per octave inside MIDI, and plays the unshifted pitch past either end', () => {
    expect(shiftOctave(60, 1)).toBe(72);
    expect(shiftOctave(60, -2)).toBe(36);
    expect(shiftOctave(120, 1)).toBe(120);
    expect(shiftOctave(115, 1)).toBe(127);
    expect(shiftOctave(5, -1)).toBe(5);
  });
});

describe('skip chance', () => {
  const counting = (value: number) => {
    const rng = () => {
      rng.draws++;
      return value;
    };
    rng.draws = 0;
    return rng;
  };

  it('draws nothing at 0, and nothing for a tie or a rest', () => {
    const rng = counting(0);
    expect(skipCell(arpNote(), 0, rng)).toEqual(arpNote());
    expect(skipCell(TIE, 1, rng)).toBe(TIE);
    expect(skipCell(REST, 1, rng)).toBe(REST);
    expect(rng.draws).toBe(0);
  });

  it('turns a note into a rest when its one draw falls under the chance', () => {
    const rng = counting(0.4);
    expect(skipCell(arpNote({ accent: true }), 0.5, rng)).toEqual(REST);
    expect(skipCell(arpNote({ accent: true }), 0.4, rng).kind).toBe('note');
    expect(rng.draws).toBe(2);
  });

  it('its stream is its own: not the walk stream, and deterministic per seed and region', () => {
    for (const [seed, region] of [
      [0, 0],
      [7, 0],
      [7, 1],
    ] as const) {
      expect(arpSkipSeed(seed, region)).not.toBe(hashSeed(seed, region));
      const skip = arpSkipRng(seed, region);
      const walk = streamRng(seed, region);
      const skipDraws = Array.from({ length: 8 }, skip);
      expect(skipDraws).not.toEqual(Array.from({ length: 8 }, walk));
      expect(Array.from({ length: 8 }, arpSkipRng(seed, region))).toEqual(skipDraws);
    }
    expect(arpSkipSeed(7, 1)).not.toBe(arpSkipSeed(7, 0));
  });
});

describe('strikeCell, a cell at a retrigger reset', () => {
  it('turns a tie into a plain note and drops a slide, keeping octave and accent', () => {
    expect(strikeCell({ kind: 'tie' })).toStrictEqual(arpNote());
    expect(strikeCell(arpNote({ slide: true, octave: -1, accent: true }))).toStrictEqual(
      arpNote({ octave: -1, accent: true }),
    );
  });

  it('leaves a note and a rest as written', () => {
    const note = arpNote({ octave: 1 });
    expect(strikeCell(note)).toBe(note);
    expect(strikeCell({ kind: 'rest' })).toStrictEqual({ kind: 'rest' });
  });
});

describe('playArpCell', () => {
  it('a note releases the held note, then strikes; its gate releases it at gate of the step', () => {
    const out = playArpCell(onset({ held: 55 }), CONFIG);
    expect(kinds(out)).toEqual([
      ['noteOff', 55],
      ['noteOn', 60],
    ]);
    expect(out.events[1]).toEqual({ kind: 'noteOn', tick: 24, time: 1, note: 60, degree: 0 });
    expect(out.held).toBe(60);
    expect(out.releaseTick).toBe(24 + 6);
  });

  it('a tie or a slide next holds the note to that onset; gate 1 always runs to it', () => {
    expect(playArpCell(onset({ holdsOn: true }), CONFIG).releaseTick).toBeNull();
    expect(playArpCell(onset(), { ...CONFIG, gate: 1 }).releaseTick).toBeNull();
  });

  it('an accent carries the part’s accent velocity and mod; an octave shifts the pitch', () => {
    const out = playArpCell(onset({ cell: arpNote({ accent: true, octave: -1 }) }), CONFIG);
    expect(out.events[0]).toMatchObject({ note: 48, accent: { velocity: 0.3, mod: 0.7 } });
  });

  it('a slide over a held note is flagged and goes out before the held note’s off', () => {
    const out = playArpCell(onset({ cell: arpNote({ slide: true }), held: 55 }), CONFIG);
    expect(kinds(out)).toEqual([
      ['noteOn', 60],
      ['noteOff', 55],
    ]);
    expect(out.events[0]).toMatchObject({ slide: true });
  });

  it('a slide with nothing held is a plain note; a slide to the pitch held is a tie', () => {
    const plain = playArpCell(onset({ cell: arpNote({ slide: true }) }), CONFIG);
    expect(plain.events).toEqual([{ kind: 'noteOn', tick: 24, time: 1, note: 60, degree: 0 }]);
    const same = playArpCell(onset({ cell: arpNote({ slide: true }), held: 60 }), CONFIG);
    expect(same).toEqual({ events: [], held: 60, releaseTick: 30 });
  });

  it('a tie emits nothing and moves the held note’s gate to its own step', () => {
    expect(playArpCell(onset({ cell: TIE, held: 55 }), CONFIG)).toEqual({
      events: [],
      held: 55,
      releaseTick: 30,
    });
    expect(playArpCell(onset({ cell: TIE, held: 55, holdsOn: true }), CONFIG).releaseTick).toBe(
      null,
    );
    expect(playArpCell(onset({ cell: TIE }), CONFIG)).toEqual({
      events: [],
      held: null,
      releaseTick: null,
    });
  });

  it('a rest releases the held note and plays nothing', () => {
    expect(playArpCell(onset({ cell: REST, held: 55 }), CONFIG)).toEqual({
      events: [{ kind: 'noteOff', tick: 24, time: 1, note: 55 }],
      held: null,
      releaseTick: null,
    });
    expect(playArpCell(onset({ cell: REST }), CONFIG).events).toEqual([]);
  });

  it('the lanes’ offsets for the cell ride on its note-on, and a cell at 0 sends none', () => {
    const values = Array.from({ length: 32 }, (_, k) => (k === 3 ? 0.5 : 0));
    const lanes = [{ param: 'filter.cutoff' as const, values }];
    const at3 = playArpCell(onset({ index: 3 }), { ...CONFIG, lanes }).events[0];
    expect(
      at3?.kind === 'noteOn' && at3.stepMod?.[VOICE_TARGET_PATHS.indexOf('filter.cutoff')],
    ).toBe(0.5);
    expect(playArpCell(onset({ index: 2 }), { ...CONFIG, lanes }).events[0]).not.toHaveProperty(
      'stepMod',
    );
  });
});
