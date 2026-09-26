import { describe, expect, it } from 'vitest';

import type {
  ChordStep,
  Harmony,
  HarmonyChord,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  CHORD_DURATIONS,
  ScaleSampler,
  TICKS_PER_BAR,
  chordAt,
  hitStep,
  restStep,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  REST_CHIP,
  appendStep,
  auditionNotes,
  chordLabel,
  currentChord,
  dialLabel,
  dropOn,
  droppedStep,
  hitChip,
  removeLast,
  stepLabel,
  stepNotes,
  turnDial,
} from './chordStepModel';

const BAR = TICKS_PER_BAR;
/** C natural minor: i for two bars, then VI for two. */
const C_MINOR: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [
    { start: 0, duration: 2 * BAR, degree: 0, size: 3 },
    { start: 2 * BAR, duration: 2 * BAR, degree: 5, size: 4 },
  ],
};
const SONG = 4 * BAR;
const SPEC = { voicing: 'close', register: { octave: 3 } } as const;
const chordIn = (harmony: Harmony, tick: number): HarmonyChord => {
  const chord = chordAt(harmony, SONG, tick);
  if (!chord) throw new Error('no chord');
  return chord;
};

const FOUR: ChordStep[] = [
  hitStep(),
  hitStep({ duration: 2, repeat: 2 }),
  restStep({ duration: 0.5 }),
  hitStep({ inversion: 1, octave: 1 }),
];

describe('chordStepModel', () => {
  it('names the Hit tile for the chord under the playhead — the timeline’s rule, not a copy', () => {
    expect(currentChord(C_MINOR, SONG, 0)).toEqual(chordAt(C_MINOR, SONG, 0));
    expect(hitChip(C_MINOR, chordIn(C_MINOR, 0))).toEqual({
      payload: { kind: 'hit' },
      name: 'Hit',
      numeral: 'C min i',
    });
    expect(chordLabel(C_MINOR, chordIn(C_MINOR, 2 * BAR))).toBe('G# maj7 VImaj7');
    expect(chordLabel(C_MINOR, null)).toBe('');
    expect(REST_CHIP).toEqual({ payload: { kind: 'rest' }, name: 'Rest', numeral: '' });
  });

  it('labels a step Hit or Rest: the chord is the timeline’s, so a root change touches no step', () => {
    expect(stepLabel(FOUR[3]!)).toBe('Hit');
    expect(stepLabel(FOUR[2]!)).toBe('Rest');
    expect(FOUR[3]).toEqual(hitStep({ inversion: 1, octave: 1 }));
  });

  it('a drop writes a root-position hit or a rest and keeps the step’s timing', () => {
    const dropped = dropOn(FOUR, 2, { kind: 'hit' });
    expect(dropped[2]).toEqual(hitStep({ duration: 0.5 }));
    expect(dropped.filter((_, i) => i !== 2)).toEqual(FOUR.filter((_, i) => i !== 2));
    expect(dropOn(FOUR, 1, { kind: 'rest' })[1]).toEqual(restStep({ duration: 2, repeat: 2 }));
    // Past the last step appends; further out, or on a full list, nothing changes.
    expect(dropOn(FOUR, 4, { kind: 'rest' })).toEqual([...FOUR, restStep()]);
    expect(dropOn(FOUR, 5, { kind: 'rest' })).toEqual(FOUR);
    const full = Array.from({ length: 32 }, () => restStep());
    expect(dropOn(full, 32, { kind: 'hit' })).toEqual(full);
    expect(droppedStep({ kind: 'hit' })).toEqual(hitStep());
  });

  it('appends a copy of the last step (a hit on an empty list) and removes down to empty', () => {
    expect(appendStep([])).toEqual([hitStep()]);
    expect(appendStep(FOUR).at(-1)).toEqual(FOUR[3]);
    expect(appendStep(FOUR).at(-1)).not.toBe(FOUR[3]);
    expect(removeLast(FOUR)).toEqual(FOUR.slice(0, 3));
    expect(removeLast([])).toEqual([]);
    const full = Array.from({ length: 32 }, () => restStep());
    expect(appendStep(full)).toEqual(full);
  });

  it('turns each dial within its bounds; a rest keeps only its timing dials', () => {
    const step = hitStep();
    expect(turnDial(step, 'octave', 1)).toMatchObject({ octave: 1 });
    expect(turnDial(hitStep({ octave: 2 }), 'octave', 1)).toMatchObject({ octave: 2 });
    expect(turnDial(hitStep({ octave: -2 }), 'octave', -1)).toMatchObject({ octave: -2 });
    expect(turnDial(hitStep({ inversion: 3 }), 'inversion', 1)).toMatchObject({ inversion: 0 });
    expect(turnDial(step, 'inversion', -1)).toMatchObject({ inversion: 3 });
    expect(turnDial(step, 'duration', 1)).toMatchObject({ duration: 1.5 });
    expect(turnDial(step, 'duration', -1)).toMatchObject({ duration: 0.75 });
    expect(turnDial(hitStep({ duration: 8 }), 'duration', 1)).toMatchObject({ duration: 8 });
    expect(turnDial(hitStep({ duration: 0.25 }), 'duration', -1)).toMatchObject({ duration: 0.25 });
    expect(turnDial(step, 'repeat', 1)).toMatchObject({ repeat: 2 });
    expect(turnDial(step, 'repeat', -1)).toMatchObject({ repeat: 1 });
    expect(turnDial(hitStep({ repeat: 8 }), 'repeat', 1)).toMatchObject({ repeat: 8 });
    const rest = restStep();
    expect(turnDial(rest, 'octave', 1)).toBe(rest);
    expect(turnDial(rest, 'inversion', 1)).toBe(rest);
    expect(turnDial(rest, 'duration', 1)).toEqual(restStep({ duration: 1.5 }));
    expect(turnDial(rest, 'repeat', 1)).toEqual(restStep({ repeat: 2 }));
    expect(CHORD_DURATIONS.indexOf(1)).toBeGreaterThan(0);
  });

  it('reads each dial', () => {
    const step = hitStep({ octave: -1, inversion: 2, duration: 0.5, repeat: 4 });
    expect(
      ['octave', 'inversion', 'duration', 'repeat'].map((d) => dialLabel(step, d as 'octave')),
    ).toEqual(['-1', 'inv 2', '×0.5', 'r4']);
    expect(dialLabel(hitStep(), 'octave')).toBe('oct');
    expect(dialLabel(restStep(), 'octave')).toBe('');
    expect(dialLabel(restStep(), 'duration')).toBe('×1');
  });

  it('auditions the current chord at the register, as the sequencer voices a hit', () => {
    const sampler = new ScaleSampler(C_MINOR);
    const c3 = sampler.rootNote(SPEC.register.octave);
    // i in root position: C, E♭, G above the register root.
    expect(auditionNotes(C_MINOR, chordIn(C_MINOR, 0), { kind: 'hit' }, SPEC)).toEqual([
      c3,
      c3 + 3,
      c3 + 7,
    ]);
    // The same tile two bars on plays VI7, and a step's inversion and octave apply on top.
    expect(auditionNotes(C_MINOR, chordIn(C_MINOR, 2 * BAR), { kind: 'hit' }, SPEC)).toEqual([
      c3 + 8,
      c3 + 12,
      c3 + 15,
      c3 + 19,
    ]);
    expect(
      stepNotes(C_MINOR, chordIn(C_MINOR, 0), hitStep({ inversion: 1, octave: 1 }), SPEC),
    ).toEqual([c3 + 15, c3 + 19, c3 + 24]);
    expect(auditionNotes(C_MINOR, chordIn(C_MINOR, 0), { kind: 'rest' }, SPEC)).toEqual([]);
    expect(stepNotes(C_MINOR, chordIn(C_MINOR, 0), restStep(), SPEC)).toEqual([]);
    expect(stepNotes(C_MINOR, null, hitStep(), SPEC)).toEqual([]);
  });
});
