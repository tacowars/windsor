import { describe, expect, it } from 'vitest';

import type { GridStep, Harmony } from '@windsor/engine';

type Key = Pick<Harmony, 'root' | 'scale'>;
import { gridNote } from '@windsor/engine';
import {
  cycleKind,
  cycleOctave,
  degreeOptions,
  foldedView,
  keySignature,
  randomSteps,
  rotateLanes,
  rotateSteps,
  setDegree,
  slideAt,
  stepLabel,
  stepsForLength,
  toggleFlag,
  withStep,
} from './gridModel';

const MINOR: Key = { root: 0, scale: 'naturalMinor' };
const PENTA: Key = { root: 0, scale: 'pentatonicMinor' };
const REST: GridStep = { kind: 'rest' };
const TIE: GridStep = { kind: 'tie' };

describe('grid step operations (#603)', () => {
  it('cycles note → tie → rest → note on the root', () => {
    expect(cycleKind(gridNote(4, { accent: true }))).toEqual(TIE);
    expect(cycleKind(TIE)).toEqual(REST);
    expect(cycleKind(REST)).toEqual(gridNote());
  });

  it('edits only a note step: degree, octave within ±2, the two flags', () => {
    expect(setDegree(gridNote(), 6)).toEqual(gridNote(6));
    expect(setDegree(REST, 6)).toEqual(REST);
    expect(cycleOctave(gridNote(), 1)).toEqual(gridNote(0, { octave: 1 }));
    expect(cycleOctave(gridNote(0, { octave: 2 }), 1)).toEqual(gridNote(0, { octave: 2 }));
    expect(cycleOctave(gridNote(0, { octave: -2 }), -1)).toEqual(gridNote(0, { octave: -2 }));
    expect(cycleOctave(TIE, 1)).toEqual(TIE);
    expect(toggleFlag(gridNote(), 'accent')).toEqual(gridNote(0, { accent: true }));
    expect(toggleFlag(toggleFlag(gridNote(), 'slide'), 'slide')).toEqual(gridNote());
    expect(toggleFlag(REST, 'slide')).toEqual(REST);
  });

  it('replaces one step and leaves the rest', () => {
    const steps = [gridNote(0), gridNote(1), gridNote(2)];
    expect(withStep(steps, 1, REST)).toEqual([gridNote(0), REST, gridNote(2)]);
    expect(steps[1]).toEqual(gridNote(1));
  });

  it('a longer loop grows the list with root notes; a shorter one keeps every written step', () => {
    const steps = [gridNote(3), gridNote(5)];
    expect(stepsForLength(steps, 4)).toEqual([gridNote(3), gridNote(5), gridNote(), gridNote()]);
    expect(stepsForLength(steps, 1)).toEqual(steps);
    expect(stepsForLength(steps, 99)).toHaveLength(32);
  });

  it('rotates the loop either way, wrapping, and leaves steps past the length alone', () => {
    const steps = [gridNote(0), gridNote(1), gridNote(2), gridNote(3), gridNote(9)];
    expect(rotateSteps(steps, 1, 4).map((s) => (s.kind === 'note' ? s.degree : -1))).toEqual([
      3, 0, 1, 2, 9,
    ]);
    expect(rotateSteps(steps, -1, 4).map((s) => (s.kind === 'note' ? s.degree : -1))).toEqual([
      1, 2, 3, 0, 9,
    ]);
    expect(rotateSteps(steps, 4, 4)).toEqual(steps);
    expect(rotateSteps(steps, 5, 4)).toEqual(rotateSteps(steps, 1, 4));
    expect(rotateSteps(steps, 2, 99)).toEqual(rotateSteps(steps, 2, 5));
    expect(rotateSteps(steps, 1, 4)).not.toBe(steps);
  });

  it('randomizes every step as a note from the scale, within the octave span, with the flag chance', () => {
    const low = randomSteps(4, 7, () => 0);
    expect(low).toEqual(
      Array.from({ length: 4 }, () => gridNote(0, { octave: -1, accent: true, slide: true })),
    );
    const high = randomSteps(3, 5, () => 0.999);
    expect(high).toEqual(Array.from({ length: 3 }, () => gridNote(4, { octave: 1 })));
    let n = 0;
    const seq = [0.5, 0.2, 0.9, 0.1];
    expect(randomSteps(1, 7, () => seq[n++ % 4]!)).toEqual([
      gridNote(3, { octave: -1, accent: false, slide: true }),
    ]);
    expect(randomSteps(32, 7, Math.random).every((s) => s.kind === 'note')).toBe(true);
  });

  it('a key signature changes with the root or the scale, named or explicit', () => {
    expect(keySignature(MINOR)).toBe('0|naturalMinor');
    expect(keySignature({ ...MINOR, root: 2 })).not.toBe(keySignature(MINOR));
    expect(keySignature({ ...MINOR, scale: [0, 7] })).toBe('0|0,7');
  });

  it('shows a degree past the scale at its folded position, flagged', () => {
    expect(foldedView(6, MINOR)).toEqual({ degree: 6, carry: 0, folded: false });
    expect(foldedView(6, PENTA)).toEqual({ degree: 1, carry: 1, folded: true });
    expect(foldedView(11, PENTA)).toEqual({ degree: 1, carry: 2, folded: true });
  });

  it('offers only the current scale’s degrees, named from the root', () => {
    expect(degreeOptions(MINOR).map((o) => o.label)).toEqual([
      '1 C',
      '2 D',
      '3 D#',
      '4 F',
      '5 G',
      '6 G#',
      '7 A#',
    ]);
    expect(degreeOptions(PENTA)).toHaveLength(5);
    expect(degreeOptions({ ...MINOR, root: 9 }).map((o) => o.label)[0]).toBe('1 A');
  });

  it('labels a step by what it will sound: name, fold carry and octave', () => {
    expect(stepLabel(REST, MINOR)).toBe('·');
    expect(stepLabel(TIE, MINOR)).toBe('—');
    expect(stepLabel(gridNote(2), MINOR)).toBe('D#');
    expect(stepLabel(gridNote(2, { octave: -1 }), MINOR)).toBe('D#-1');
    // Degree 6 in five degrees: degree 1 (D#) one octave up.
    expect(stepLabel(gridNote(6), PENTA)).toBe('D#+1');
    expect(stepLabel(gridNote(6, { octave: -1 }), PENTA)).toBe('D#');
  });
});

describe('lanes turn with the steps (windsor#31)', () => {
  it('rotates each lane over the loop and leaves the values past it in place', () => {
    const lanes = [{ param: 'filter.cutoff' as const, values: [0.1, 0.2, 0.3, 0.4, 0.9] }];
    expect(rotateLanes(lanes, 1, 4)).toEqual([
      { param: 'filter.cutoff', values: [0.4, 0.1, 0.2, 0.3, 0.9] },
    ]);
    expect(rotateLanes(lanes, -1, 4)[0]!.values).toEqual([0.2, 0.3, 0.4, 0.1, 0.9]);
  });
});

describe('how a step meets the note before it (windsor#31)', () => {
  const slide = (degree: number, octave = 0): GridStep => gridNote(degree, { octave, slide: true });
  const at = (
    steps: GridStep[],
    index: number,
    length = steps.length,
    skipChance = 0,
    key = MINOR,
  ) => slideAt({ steps, length, skipChance }, index, key);

  it('reads a slide onto a new pitch as a retarget, and onto the held pitch as nothing new', () => {
    const steps = [gridNote(0), slide(2), slide(2), gridNote(4)];
    expect(at(steps, 1)).toEqual({ kind: 'retarget', when: 'always' });
    expect(at(steps, 2)).toEqual({ kind: 'same', when: 'always' });
    expect(at(steps, 3).kind).toBe('none');
    expect(at(steps, 0).kind).toBe('none');
  });

  it('holds across ties, and a rest holds nothing', () => {
    expect(at([gridNote(3), TIE, TIE, slide(3)], 3)).toEqual({ kind: 'same', when: 'always' });
    expect(at([gridNote(3), REST, TIE, slide(3)], 3).kind).toBe('none');
  });

  it('leaves a slide whose held note wraps round the loop to the run: a region entry holds nothing', () => {
    const steps = [slide(0), gridNote(1), gridNote(0), REST];
    expect(at(steps, 0, 2)).toEqual({ kind: 'retarget', when: 'wrap' });
    expect(at(steps, 0, 3)).toEqual({ kind: 'same', when: 'wrap' });
    expect(at([slide(5), TIE], 0)).toEqual({ kind: 'same', when: 'wrap' });
    expect(at([TIE, slide(1), gridNote(0)], 1)).toEqual({ kind: 'retarget', when: 'wrap' });
    expect(at([slide(0), REST], 0).kind).toBe('none');
  });

  it('leaves a slide after a note Skip may drop to the run', () => {
    const steps = [gridNote(0), TIE, slide(2)];
    expect(at(steps, 2, 3, 0.25)).toEqual({ kind: 'retarget', when: 'skip' });
    expect(at(steps, 2, 3, 0)).toEqual({ kind: 'retarget', when: 'always' });
  });

  it('ignores the steps past the loop', () => {
    expect(at([gridNote(0), slide(1)], 1, 1).kind).toBe('none');
  });

  it('compares pitches as the engine plays them, a folded degree meeting its octave', () => {
    // Degree 5 in the five-degree pentatonic is the root an octave up.
    expect(at([gridNote(0, { octave: 1 }), slide(5)], 1, 2, 0, PENTA).kind).toBe('same');
    expect(at([gridNote(0), slide(0, 1)], 1, 2, 0, PENTA).kind).toBe('retarget');
  });
});
