/**
 * The chord card's step operations (#607), without the DOM: what a drop or a
 * cell click does to a `ChordSpec`'s step list, what the picker's chips and
 * a step's tile read for the song's current key, and which step the
 * transport is on. Every function returns a new list; the card writes it
 * through `ctx.change`, where arrays replace wholesale.
 */
import type {
  ArrangementKey,
  ChordChordStep,
  ChordSize,
  ChordSpec,
  ChordStep,
  ChordVoicingId,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  CHORD_DURATIONS,
  CHORD_INVERSION_MAX,
  CHORD_REPEAT_MAX,
  CHORD_SEMITONE_MAX,
  CHORD_STEPS_MAX,
  CHORD_STEP_OCTAVE_MAX,
  chordName,
  chordOf,
  chordStep,
  diatonicChords,
  layoutSegments,
  restStep,
  romanNumeral,
  scaleOffsets,
  voiceChord,
} from '../../../packages/client/src/audio/index-for-editor';

export { CHORD_STEPS_MAX };

/** What a chip carries, and what a drop writes: a chord of the key, or a rest. */
export type ChordPayload = { kind: 'chord'; degree: number; size: ChordSize } | { kind: 'rest' };

export interface Chip {
  readonly payload: ChordPayload;
  /** `C min`, or `Rest`. */
  readonly name: string;
  /** `i`, `V7`; empty for the rest tile. */
  readonly numeral: string;
}

/** One chip per degree of the current scale, at the picker's size. */
export function pickerChips(key: ArrangementKey, size: ChordSize): Chip[] {
  const offsets = scaleOffsets(key.scale);
  return diatonicChords(offsets, size).map((chord) => ({
    payload: { kind: 'chord', degree: chord.degree, size },
    name: chordName(key.root, chord),
    numeral: romanNumeral(chord.degree, chord.quality, offsets.length),
  }));
}

export const REST_CHIP: Chip = { payload: { kind: 'rest' }, name: 'Rest', numeral: '' };

/** A step's tile: its name and numeral for the current key, or `Rest`. */
export function stepLabel(step: ChordStep, key: ArrangementKey): { name: string; numeral: string } {
  if (step.kind === 'rest') return { name: 'Rest', numeral: '' };
  const offsets = scaleOffsets(key.scale);
  const chord = chordOf(offsets, step.degree, step.size);
  return {
    name: chordName(key.root, chord),
    numeral: romanNumeral(step.degree, chord.quality, offsets.length),
  };
}

/** The notes a chip sounds when pressed: root position, the part's voicing, at its register octave. */
export function auditionNotes(
  key: ArrangementKey,
  payload: ChordPayload,
  voicing: ChordVoicingId,
  octave: number,
): number[] {
  if (payload.kind === 'rest') return [];
  const chord = chordOf(scaleOffsets(key.scale), payload.degree, payload.size);
  return voiceChord(chord.stack, { inversion: 0, voicing, octave, semitone: 0 }, key.root);
}

/** The notes a step's tile sounds when pressed: the step as the sequencer would play it. */
export function stepNotes(
  key: ArrangementKey,
  step: ChordStep,
  voicing: ChordVoicingId,
  octave: number,
): number[] {
  if (step.kind === 'rest') return [];
  const chord = chordOf(scaleOffsets(key.scale), step.degree, step.size);
  return voiceChord(
    chord.stack,
    {
      inversion: step.inversion,
      voicing,
      octave: octave + step.octave,
      semitone: step.semitone,
    },
    key.root,
  );
}

/** The step a drop writes: the payload's chord (root position, no shift) over the step's timing. */
export function droppedStep(payload: ChordPayload, over?: ChordStep): ChordStep {
  const timing = over ? { duration: over.duration, repeat: over.repeat } : {};
  if (payload.kind === 'rest') return restStep(timing);
  return chordStep(payload.degree, { size: payload.size, ...timing });
}

export function withStep(steps: readonly ChordStep[], index: number, step: ChordStep): ChordStep[] {
  return steps.map((s, i) => (i === index ? step : s));
}

/** The list with a step dropped on `index`, or appended when `index` is the list's length; full lists are unchanged. */
export function dropOn(
  steps: readonly ChordStep[],
  index: number,
  payload: ChordPayload,
): ChordStep[] {
  if (index >= 0 && index < steps.length) {
    return withStep(steps, index, droppedStep(payload, steps[index]));
  }
  if (index === steps.length && steps.length < CHORD_STEPS_MAX) {
    return [...steps, droppedStep(payload)];
  }
  return [...steps];
}

/** A copy of the last step appended (a rest on an empty list); a full list is unchanged. */
export function appendStep(steps: readonly ChordStep[]): ChordStep[] {
  if (steps.length >= CHORD_STEPS_MAX) return [...steps];
  const last = steps[steps.length - 1];
  return [...steps, last ? { ...last } : restStep()];
}

/** The list without its last step; an empty list stays empty. */
export function removeLast(steps: readonly ChordStep[]): ChordStep[] {
  return steps.slice(0, -1);
}

/** The per-step fields a cell turns, and how far each goes. */
export type StepDial = 'octave' | 'inversion' | 'semitone' | 'duration' | 'repeat';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** A chord-only edit; a rest is returned unchanged. */
function editChord(step: ChordStep, edit: (chord: ChordChordStep) => ChordChordStep): ChordStep {
  return step.kind === 'chord' ? edit(step) : step;
}

/**
 * Turn one dial by `direction`: octave, inversion and semitone stop at their
 * bounds (inversion wraps past `CHORD_INVERSION_MAX` back to 0, so a click
 * cycles it); duration walks the table; repeat counts 1–`CHORD_REPEAT_MAX`.
 * Octave, inversion and semitone are chord-only; a rest keeps its timing dials.
 */
export function turnDial(step: ChordStep, dial: StepDial, direction: 1 | -1): ChordStep {
  switch (dial) {
    case 'octave':
      return editChord(step, (c) => ({
        ...c,
        octave: clamp(c.octave + direction, -CHORD_STEP_OCTAVE_MAX, CHORD_STEP_OCTAVE_MAX),
      }));
    case 'inversion': {
      const span = CHORD_INVERSION_MAX + 1;
      return editChord(step, (c) => ({
        ...c,
        inversion: (((c.inversion + direction) % span) + span) % span,
      }));
    }
    case 'semitone':
      return editChord(step, (c) => ({
        ...c,
        semitone: clamp(c.semitone + direction, -CHORD_SEMITONE_MAX, CHORD_SEMITONE_MAX),
      }));
    case 'duration': {
      const at = CHORD_DURATIONS.indexOf(step.duration);
      const next = clamp(
        (at < 0 ? CHORD_DURATIONS.indexOf(1) : at) + direction,
        0,
        CHORD_DURATIONS.length - 1,
      );
      return { ...step, duration: CHORD_DURATIONS[next] ?? step.duration };
    }
    case 'repeat':
      return { ...step, repeat: clamp(step.repeat + direction, 1, CHORD_REPEAT_MAX) };
  }
}

/** What a dial's cell reads. */
export function dialLabel(step: ChordStep, dial: StepDial): string {
  if (dial === 'duration') return `×${step.duration}`;
  if (dial === 'repeat') return `r${step.repeat}`;
  if (step.kind !== 'chord') return '';
  const value = step[dial];
  if (dial === 'inversion') return `inv ${value}`;
  if (value === 0) return dial === 'octave' ? 'oct' : 'semi';
  return `${value > 0 ? '+' : ''}${value}`;
}

/** The step index the transport is on for `tick`, or -1 when the pattern is empty. */
export function stepAtTick(spec: ChordSpec, tick: number): number {
  const segments = layoutSegments({ ...spec, seed: 0, generatorIndex: 0 });
  const last = segments[segments.length - 1];
  if (!last) return -1;
  const length = last.start + last.ticks;
  const offset = ((tick % length) + length) % length;
  let found = -1;
  for (const segment of segments) {
    if (segment.start > offset) break;
    found = segment.step;
  }
  return found;
}
