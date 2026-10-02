/**
 * The Basslead strip's writes (windsor#371, record
 * `2026-10-01-sequencer-rack-devices` decisions 6 and 9): every strip
 * cell, Length, Rotate and Randomize writes the engine's fields, and a
 * song written before windsor#367 opens as one bar of plain notes.
 */
import { describe, expect, it } from 'vitest';

import type { BassStep, StepModLane } from '@windsor/engine';
import {
  DEFAULT_BASS_CONFIG,
  DIVISORS,
  GRID_STEPS_MAX,
  GRID_STEP_OCTAVE_MAX,
  RATCHET_MAX,
  bassNote,
  defaultBassSteps,
  partAt,
} from '@windsor/engine';
import { nextArpKind } from './arpGridModel';
import { BASS_RANDOM } from './bassGridConstants';
import {
  bassLengthChange,
  bassSlideAt,
  bassStepsLabel,
  randomBassSteps,
  rotateBass,
} from './bassGridModel';
import { DocumentModel } from './documentModel';
import { cycleOctave, toggleFlag } from './gridModel';
import { cycleStepRatchet } from './ratchetModel';
import { newSong } from './songParts';

const N = bassNote;
const REST: BassStep = { kind: 'rest' };
const TIE: BassStep = { kind: 'tie' };
const lane = (values: number[]): StepModLane => ({ param: 'filter.cutoff', values });

/** A draw that hands back `values` in order, then 0.99. */
function script(values: number[]): () => number {
  let i = 0;
  return () => values[i++] ?? 0.99;
}

describe('a strip cell (the Arp’s, on a bass step)', () => {
  it('cycles note → tie → rest → a plain note, a note losing its octave, flags and ratchet', () => {
    const rich = N({ octave: 1, accent: true, slide: true, ratchet: 3 });
    expect(nextArpKind(rich)).toEqual(TIE);
    expect(nextArpKind(TIE)).toEqual(REST);
    expect(nextArpKind(REST)).toEqual(N());
  });

  it('shifts the octave within ±GRID_STEP_OCTAVE_MAX, and leaves a rest or a tie alone', () => {
    let step: BassStep = N();
    for (let i = 0; i < GRID_STEP_OCTAVE_MAX + 2; i++) step = cycleOctave(step, 1);
    expect(step).toEqual(N({ octave: GRID_STEP_OCTAVE_MAX }));
    for (let i = 0; i < 2 * GRID_STEP_OCTAVE_MAX + 2; i++) step = cycleOctave(step, -1);
    expect(step).toEqual(N({ octave: -GRID_STEP_OCTAVE_MAX }));
    expect(cycleOctave(REST, 1)).toBe(REST);
  });

  it('toggles accent and slide on a note only', () => {
    expect(toggleFlag(N(), 'accent')).toEqual(N({ accent: true }));
    expect(toggleFlag(N({ slide: true }), 'slide')).toEqual(N());
    expect(toggleFlag(TIE, 'accent')).toBe(TIE);
  });

  it('cycles a ratchet ×1 → ×2 → ×3 → ×4 → ×1, writing no field at ×1, and none on a rest or tie', () => {
    const rolls: (number | undefined)[] = [];
    let step: BassStep = N();
    for (let i = 0; i < RATCHET_MAX; i++) {
      step = cycleStepRatchet(step);
      rolls.push(step.kind === 'note' ? step.ratchet : -1);
    }
    expect(rolls).toEqual([2, 3, 4, undefined]);
    expect(step).toEqual(N());
    expect('ratchet' in step).toBe(false);
    expect(cycleStepRatchet(REST)).toBe(REST);
    expect(cycleStepRatchet(TIE)).toBe(TIE);
  });
});

describe('Length', () => {
  const spec = {
    steps: [N(), REST, N({ accent: true })],
    length: 3,
    lanes: [lane([0.5, 0, -0.5])],
  };

  it('pads the steps with plain notes and each lane with 0 past the written steps', () => {
    const change = bassLengthChange(spec, 5);
    expect(change.length).toBe(5);
    expect(change.steps).toEqual([...spec.steps, N(), N()]);
    expect(change.lanes).toEqual([lane([0.5, 0, -0.5, 0, 0])]);
  });

  it('trims the loop and keeps the steps and lane values past it', () => {
    const change = bassLengthChange(spec, 1);
    expect(change.length).toBe(1);
    expect(change.steps).toEqual(spec.steps);
    expect(change.lanes).toEqual(spec.lanes);
  });

  it('holds the loop to 1..GRID_STEPS_MAX and rounds a knob’s value', () => {
    expect(bassLengthChange(spec, 0).length).toBe(1);
    expect(bassLengthChange(spec, 2.6).length).toBe(3);
    const longest = bassLengthChange(spec, GRID_STEPS_MAX + 4);
    expect(longest.length).toBe(GRID_STEPS_MAX);
    expect(longest.steps).toHaveLength(GRID_STEPS_MAX);
    expect(longest.lanes[0]?.values).toHaveLength(GRID_STEPS_MAX);
  });
});

describe('Rotate', () => {
  it('turns the loop’s steps, ratchets and lane values together, and leaves the steps past it', () => {
    const steps = [N({ ratchet: 2 }), REST, N({ octave: 1 }), TIE, N({ accent: true })];
    const spec = { steps, length: 4, lanes: [lane([0.1, 0.2, 0.3, 0.4, 0.5])] };
    const turned = rotateBass(spec, 1);
    expect(turned.steps).toEqual([TIE, N({ ratchet: 2 }), REST, N({ octave: 1 }), steps[4]]);
    expect(turned.lanes).toEqual([lane([0.4, 0.1, 0.2, 0.3, 0.5])]);
    expect(rotateBass({ ...spec, ...turned }, -1)).toEqual({ steps, lanes: spec.lanes });
  });
});

describe('Randomize', () => {
  it('rerolls every written step from the table, seven draws a step, and never writes a pitch', () => {
    const steps = [N(), N(), N()];
    // A note shifted down with accent and a ×2 roll; a rest; a tie.
    const draw = script([0.9, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2]);
    const out = randomBassSteps(steps, draw);
    expect(out).toEqual([N({ octave: -1, accent: true, ratchet: 2 }), REST, TIE]);
    for (const step of out) {
      for (const key of Object.keys(step)) {
        expect(['kind', 'octave', 'accent', 'slide', 'ratchet']).toContain(key);
      }
    }
  });

  it('draws rests and ties at the table’s chances, and no roll on a rest or a tie', () => {
    expect(BASS_RANDOM.rest + BASS_RANDOM.tie).toBeLessThan(1);
    const steps = Array.from({ length: 32 }, () => N());
    const out = randomBassSteps(steps, () => BASS_RANDOM.rest / 2);
    expect(out.every((step) => step.kind === 'rest')).toBe(true);
  });
});

describe('the Steps label', () => {
  it('names the loop and the bars it spans at the rate', () => {
    expect(bassStepsLabel(16, DIVISORS.eighth)).toBe('16 · 2 bars');
    expect(bassStepsLabel(8, DIVISORS.eighth)).toBe('8 · 1 bar');
    expect(bassStepsLabel(19, DIVISORS.eighth)).toBe('19 · 2.375 bars');
    expect(bassStepsLabel(32, DIVISORS.sixteenth)).toBe('32 · 2 bars');
  });
});

describe('bassSlideAt', () => {
  const base = { length: 4, density: 1, pitchMode: 'fixed' as const };

  it('reads a Fixed slide by its octave: same ties, a shift retargets', () => {
    const steps = [N(), N({ slide: true }), N({ octave: 1, slide: true }), REST];
    expect(bassSlideAt({ ...base, steps }, 1)).toEqual({ kind: 'same', when: 'always' });
    expect(bassSlideAt({ ...base, steps }, 2)).toEqual({ kind: 'retarget', when: 'always' });
  });

  it('cannot know a followed pitch, walks back over ties, and holds nothing after a rest', () => {
    const steps = [N(), TIE, N({ slide: true }), REST, N({ slide: true })];
    const follow = { ...base, length: 5, pitchMode: 'followRoot' as const, steps };
    expect(bassSlideAt(follow, 2)).toEqual({ kind: 'either', when: 'always' });
    expect(bassSlideAt(follow, 4)).toEqual({ kind: 'none', when: 'always' });
  });

  it('holds across the wrap only once looping, and depends on Density below 1', () => {
    const steps = [N({ slide: true }), N(), N({ slide: true })];
    const spec = { ...base, length: 3, steps };
    expect(bassSlideAt(spec, 0)).toEqual({ kind: 'same', when: 'wrap' });
    expect(bassSlideAt({ ...spec, density: 0.5 }, 2)).toEqual({ kind: 'same', when: 'skip' });
    expect(bassSlideAt({ ...spec, length: 2 }, 2).kind).toBe('none');
  });
});

describe('a song saved before windsor#367', () => {
  it('opens with one bar of plain notes, as the Basslead played it', () => {
    const raw = newSong();
    const [part] = raw.parts as Record<string, unknown>[];
    const strip = new Set(['steps', 'length', 'lanes', 'accentVelocity', 'accentMod']);
    const old = Object.fromEntries(
      Object.entries(DEFAULT_BASS_CONFIG).filter(([field]) => !strip.has(field)),
    );
    expect(Object.keys(old)).not.toContain('steps');
    const model = new DocumentModel({
      ...raw,
      parts: [{ ...part, sequencer: { kind: 'bass', ...old, divisor: DIVISORS.sixteenth } }],
    });
    const slot = model.doc.parts[0]!.slot;
    const sequencer = partAt(model.doc, slot)?.sequencer;
    expect(sequencer?.kind).toBe('bass');
    if (sequencer?.kind !== 'bass') return;
    expect(sequencer.steps).toEqual(defaultBassSteps(DIVISORS.sixteenth));
    expect(sequencer.steps).toHaveLength(16);
    expect(sequencer.length).toBe(16);
    expect(sequencer.steps.every((step) => step.kind === 'note' && !step.ratchet)).toBe(true);
  });
});
