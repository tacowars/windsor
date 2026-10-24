/**
 * How one arp cell plays (windsor#129): the cell index, the gate's
 * look-ahead, the octave shift and its MIDI fallback, step variation on a
 * cell and its own stream, and what each kind of cell emits over the note
 * held into it.
 * The arpeggiator driving them is `arpeggiatorGrid.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { VOICE_TARGET_PATHS } from '../worklet/fm/voiceTargetTables';
import { GATE_MIN } from '../audioConstants';
import {
  arpCellIndex,
  arpPlayedGate,
  arpVariationRng,
  arpVariationSeed,
  flipCell,
  holdsToNext,
  playArpCell,
  shiftOctave,
  strikeCell,
  variedCell,
  type ArpCellConfig,
  type ArpOnset,
  type ArpVariationContext,
} from './arpCellPlay';
import { arpNote, defaultArpSteps, type ArpStep } from './arpSteps';
import { hashSeed, streamRng } from './generatorSeed';
import type { StepDraw } from './stepVariation';

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

describe('step variation on a cell (windsor#935, windsor#945)', () => {
  const DRAW: StepDraw = { flip: 0, velocity: -1, pitch: 1, gate: 1 };
  const LIST = [48, 52, 55, 60];
  const context = (over: Partial<ArpVariationContext['config']> = {}): ArpVariationContext => ({
    list: LIST,
    at: 1,
    config: { gate: 0.5, randomness: 1, octaveMode: false, ...over },
  });

  it('flips a note to a rest and a rest to a plain note; a tie never flips', () => {
    expect(flipCell(arpNote({ accent: true, ratchet: 3 }))).toEqual(REST);
    expect(flipCell(REST)).toEqual(arpNote());
    expect(flipCell(TIE)).toBe(TIE);
  });

  it('plays as written with no draw, and varies nothing on a tie or a rest', () => {
    const cell = arpNote({ octave: 1, gate: 0.5 });
    expect(variedCell(cell, null, context())).toEqual({ cell, pitch: 52, gate: 0.25 });
    expect(variedCell(TIE, DRAW, context())).toEqual({ cell: TIE, pitch: 52, gate: 0.5 });
  });

  it('borrows the list neighbour a normal offset away, wrapping, and keeps the cell', () => {
    const cell = arpNote({ octave: 1 });
    // z = 1: σ = 0.25 × 4 notes = 1 place up; the gate moves up 0.25 and the velocity offset is −0.2.
    const varied = variedCell(cell, DRAW, context());
    expect(varied).toEqual({ cell, pitch: 55, gate: 0.75, velocityOffset: -0.2 });
    const wrapped = variedCell(cell, { ...DRAW, pitch: 2.5 }, { ...context(), at: 3 });
    expect(wrapped.pitch).toBe(LIST[(3 + 3) % 4]);
  });

  it('with Octave on, moves the cell’s own note by whole octaves, its shift folded into the pitch', () => {
    const varied = variedCell(arpNote({ octave: 1 }), DRAW, context({ octaveMode: true }));
    expect(varied.cell).toEqual(arpNote({ octave: 0 }));
    expect(varied.pitch).toBe(52 + 12 + 12);
  });

  it('its stream is its own: not the walk stream, and deterministic per seed and region', () => {
    for (const [seed, region] of [
      [0, 0],
      [7, 0],
      [7, 1],
    ] as const) {
      expect(arpVariationSeed(seed, region)).not.toBe(hashSeed(seed, region));
      const variation = arpVariationRng(seed, region);
      const walk = streamRng(seed, region);
      const draws = Array.from({ length: 8 }, variation);
      expect(draws).not.toEqual(Array.from({ length: 8 }, walk));
      expect(Array.from({ length: 8 }, arpVariationRng(seed, region))).toEqual(draws);
    }
    expect(arpVariationSeed(7, 1)).not.toBe(arpVariationSeed(7, 0));
  });

  it('an effect whose roll failed plays as written while the others vary', () => {
    const cell = arpNote();
    const pitchOnly = variedCell(cell, { pitch: 1 }, context());
    expect(pitchOnly).toEqual({ cell, pitch: 55, gate: 0.5, velocityOffset: undefined });
    const gateAndVelocity = variedCell(cell, { velocity: 1, gate: -1 }, context());
    expect(gateAndVelocity).toEqual({ cell, pitch: 52, gate: 0.25, velocityOffset: 0.2 });
    const octaveFolded = variedCell(
      arpNote({ octave: 1 }),
      { gate: 1 },
      context({ octaveMode: true }),
    );
    expect(octaveFolded.pitch).toBe(52 + 12);
  });

  it('a varied velocity offset reaches the note-on, and a plain onset sends none', () => {
    const on = (o: ReturnType<typeof playArpCell>) => o.events.find((e) => e.kind === 'noteOn');
    const varied = on(playArpCell(onset({ velocityOffset: 0.15 }), CONFIG));
    expect(varied).toMatchObject({ velocityOffset: 0.15 });
    expect(varied).not.toHaveProperty('velocity');
    expect(on(playArpCell(onset(), CONFIG))).not.toHaveProperty('velocityOffset');
  });
});

describe('arpPlayedGate, a cell’s gate over the part’s (windsor#933)', () => {
  it('scales the part’s gate by the cell’s, floored at GATE_MIN', () => {
    expect(arpPlayedGate(0.8, arpNote({ gate: 0.5 }))).toBe(0.4);
    expect(arpPlayedGate(1, arpNote({ gate: 1 }))).toBe(1);
    expect(arpPlayedGate(0.02, arpNote({ gate: 0.1 }))).toBe(GATE_MIN);
  });

  it('a cell with no gate, a tie and a rest play the part’s gate as it is', () => {
    for (const cell of [arpNote(), TIE, REST]) expect(arpPlayedGate(0.7, cell)).toBe(0.7);
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

  it('the onset’s gate, where it carries one, stands in for the config’s (windsor#933)', () => {
    expect(playArpCell(onset({ gate: 0.25 }), CONFIG).releaseTick).toBe(24 + 3);
    expect(playArpCell(onset({ gate: 1 }), CONFIG).releaseTick).toBeNull();
    expect(playArpCell(onset({ gate: 0.25, holdsOn: true }), CONFIG).releaseTick).toBeNull();
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
