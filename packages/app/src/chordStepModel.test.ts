import { describe, expect, it } from 'vitest';

import type {
  ArrangementKey,
  ChordSpec,
  ChordStep,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  CHORD_DURATIONS,
  DEFAULT_CHORD_CONFIG,
  chordStep,
  restStep,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  REST_CHIP,
  appendStep,
  auditionNotes,
  dialLabel,
  dropOn,
  droppedStep,
  pickerChips,
  removeLast,
  stepAtTick,
  stepLabel,
  turnDial,
} from './chordStepModel';

const C_MINOR: ArrangementKey = { root: 48, scale: 'naturalMinor', weights: [1, 1, 1, 1, 1, 1, 1] };
const D_MINOR: ArrangementKey = { root: 50, scale: 'naturalMinor', weights: [1, 1, 1, 1, 1, 1, 1] };
const PENTA: ArrangementKey = { root: 60, scale: 'pentatonicMajor', weights: [1, 1, 1, 1, 1] };

const FOUR: ChordStep[] = [
  chordStep(0),
  chordStep(5, { duration: 2, repeat: 2 }),
  restStep({ duration: 0.5 }),
  chordStep(4, { size: 4, inversion: 1, octave: 1, semitone: -2 }),
];

const spec = (steps: ChordStep[], over: Partial<ChordSpec> = {}): ChordSpec => ({
  kind: 'chord',
  ...DEFAULT_CHORD_CONFIG,
  steps,
  ...over,
});

describe('chordStepModel', () => {
  it('labels the picker for C natural minor as Scaler does, and five chips for a pentatonic', () => {
    expect(pickerChips(C_MINOR, 3).map((c) => `${c.name} ${c.numeral}`)).toEqual([
      'C min i',
      'D dim ii°',
      'D# maj III',
      'F min iv',
      'G min v',
      'G# maj VI',
      'A# maj VII',
    ]);
    expect(pickerChips(C_MINOR, 4)[4]).toMatchObject({
      payload: { kind: 'chord', degree: 4, size: 4 },
      name: 'G min7',
      numeral: 'v7',
    });
    const penta = pickerChips(PENTA, 3);
    expect(penta).toHaveLength(5);
    expect(penta.map((c) => c.numeral)).toEqual(['1', '2', '3', '4', '5']);
    expect(REST_CHIP).toEqual({ payload: { kind: 'rest' }, name: 'Rest', numeral: '' });
  });

  it('labels a step for the current key, and relabelling after a root change touches no step', () => {
    expect(stepLabel(FOUR[3]!, C_MINOR)).toEqual({ name: 'G min7', numeral: 'v7' });
    expect(stepLabel(FOUR[2]!, C_MINOR)).toEqual({ name: 'Rest', numeral: '' });
    expect(stepLabel(FOUR[3]!, D_MINOR)).toEqual({ name: 'A min7', numeral: 'v7' });
    expect(FOUR[3]).toEqual(chordStep(4, { size: 4, inversion: 1, octave: 1, semitone: -2 }));
  });

  it('a drop writes the chip’s chord in root position and keeps the step’s timing', () => {
    const dropped = dropOn(FOUR, 1, { kind: 'chord', degree: 2, size: 4 });
    expect(dropped[1]).toEqual(chordStep(2, { size: 4, duration: 2, repeat: 2 }));
    expect(dropped.filter((_, i) => i !== 1)).toEqual(FOUR.filter((_, i) => i !== 1));
    // A rest onto a chord keeps its timing too; a chord onto a rest likewise.
    expect(dropOn(FOUR, 1, { kind: 'rest' })[1]).toEqual(restStep({ duration: 2, repeat: 2 }));
    expect(dropOn(FOUR, 2, { kind: 'chord', degree: 0, size: 3 })[2]).toEqual(
      chordStep(0, { duration: 0.5 }),
    );
    // Past the last step appends; further out, or on a full list, nothing changes.
    expect(dropOn(FOUR, 4, { kind: 'rest' })).toEqual([...FOUR, restStep()]);
    expect(dropOn(FOUR, 5, { kind: 'rest' })).toEqual(FOUR);
    const full = Array.from({ length: 32 }, () => restStep());
    expect(dropOn(full, 32, { kind: 'chord', degree: 0, size: 3 })).toEqual(full);
    expect(droppedStep({ kind: 'chord', degree: 6, size: 3 })).toEqual(chordStep(6));
  });

  it('appends a copy of the last step (a rest on an empty list) and removes down to empty', () => {
    expect(appendStep([])).toEqual([restStep()]);
    expect(appendStep(FOUR).at(-1)).toEqual(FOUR[3]);
    expect(appendStep(FOUR).at(-1)).not.toBe(FOUR[3]);
    expect(removeLast(FOUR)).toEqual(FOUR.slice(0, 3));
    expect(removeLast([])).toEqual([]);
    const full = Array.from({ length: 32 }, () => restStep());
    expect(appendStep(full)).toEqual(full);
  });

  it('turns each dial within its bounds; a rest keeps only its timing dials', () => {
    const step = chordStep(0);
    expect(turnDial(step, 'octave', 1)).toMatchObject({ octave: 1 });
    expect(turnDial(chordStep(0, { octave: 2 }), 'octave', 1)).toMatchObject({ octave: 2 });
    expect(turnDial(chordStep(0, { octave: -2 }), 'octave', -1)).toMatchObject({ octave: -2 });
    expect(turnDial(chordStep(0, { inversion: 3 }), 'inversion', 1)).toMatchObject({
      inversion: 0,
    });
    expect(turnDial(step, 'inversion', -1)).toMatchObject({ inversion: 3 });
    expect(turnDial(chordStep(0, { semitone: 11 }), 'semitone', 1)).toMatchObject({ semitone: 11 });
    expect(turnDial(step, 'semitone', -1)).toMatchObject({ semitone: -1 });
    expect(turnDial(step, 'duration', 1)).toMatchObject({ duration: 1.5 });
    expect(turnDial(step, 'duration', -1)).toMatchObject({ duration: 0.75 });
    expect(turnDial(chordStep(0, { duration: 8 }), 'duration', 1)).toMatchObject({ duration: 8 });
    expect(turnDial(chordStep(0, { duration: 0.25 }), 'duration', -1)).toMatchObject({
      duration: 0.25,
    });
    expect(turnDial(step, 'repeat', 1)).toMatchObject({ repeat: 2 });
    expect(turnDial(step, 'repeat', -1)).toMatchObject({ repeat: 1 });
    expect(turnDial(chordStep(0, { repeat: 8 }), 'repeat', 1)).toMatchObject({ repeat: 8 });
    const rest = restStep();
    expect(turnDial(rest, 'octave', 1)).toBe(rest);
    expect(turnDial(rest, 'inversion', 1)).toBe(rest);
    expect(turnDial(rest, 'semitone', 1)).toBe(rest);
    expect(turnDial(rest, 'duration', 1)).toEqual(restStep({ duration: 1.5 }));
    expect(turnDial(rest, 'repeat', 1)).toEqual(restStep({ repeat: 2 }));
    expect(CHORD_DURATIONS.indexOf(1)).toBeGreaterThan(0);
  });

  it('reads each dial', () => {
    const step = chordStep(0, { octave: -1, inversion: 2, semitone: 3, duration: 0.5, repeat: 4 });
    expect(
      ['octave', 'inversion', 'semitone', 'duration', 'repeat'].map((d) =>
        dialLabel(step, d as 'octave'),
      ),
    ).toEqual(['-1', 'inv 2', '+3', '×0.5', 'r4']);
    expect(dialLabel(chordStep(0), 'octave')).toBe('oct');
    expect(dialLabel(chordStep(0), 'semitone')).toBe('semi');
    expect(dialLabel(restStep(), 'octave')).toBe('');
    expect(dialLabel(restStep(), 'duration')).toBe('×1');
  });

  it('auditions a chip in root position through the voicing at the register octave', () => {
    expect(auditionNotes(C_MINOR, { kind: 'chord', degree: 0, size: 3 }, 'close', 0)).toEqual([
      48, 51, 55,
    ]);
    expect(auditionNotes(C_MINOR, { kind: 'chord', degree: 0, size: 4 }, 'drop2', 1)).toEqual([
      55, 60, 63, 70,
    ]);
    expect(auditionNotes(C_MINOR, { kind: 'rest' }, 'close', 0)).toEqual([]);
  });

  it('finds the step the transport is on, across repeats and a length that does not divide the bar', () => {
    const s = spec(FOUR);
    // 96 | 192 ×2 = 384 | 48 | 96 → 624 ticks.
    expect(stepAtTick(s, 0)).toBe(0);
    expect(stepAtTick(s, 95)).toBe(0);
    expect(stepAtTick(s, 96)).toBe(1);
    expect(stepAtTick(s, 479)).toBe(1);
    expect(stepAtTick(s, 480)).toBe(2);
    expect(stepAtTick(s, 528)).toBe(3);
    expect(stepAtTick(s, 624)).toBe(0);
    expect(stepAtTick(s, 624 * 3 + 500)).toBe(2);
    expect(stepAtTick(spec([]), 10)).toBe(-1);
    expect(stepAtTick(spec([chordStep(0, { duration: 0.75 })], { divisor: 24 }), 40)).toBe(0);
  });
});
