/**
 * The chord card's step operations (#607, #705), without the DOM: what a drop
 * or a cell click does to a `ChordSpec`'s step list, and what the Hit tile
 * and a step's tile sound. Since #705 a step carries no pitch (epic #703
 * decision 15): a hit voices the chord the song's harmony timeline holds at
 * the transport tick, so the picker is one Hit tile and one Rest tile, and
 * an audition asks the engine (`chordAt`, `voiceHit`) for the current chord
 * and its notes — never a copy of either rule. Every function returns a new
 * list; the card writes it through `ctx.change`, where arrays replace
 * wholesale. Which step the transport is on is the engine's answer, not a
 * copy here: the card's playhead reads `host.stepAt` (#619 decision 2).
 */
import type { ChordHitStep, ChordSpec, ChordStep, Harmony, HarmonyChord } from '@windsor/engine';
import {
  CHORD_DURATIONS,
  CHORD_INVERSION_MAX,
  CHORD_REPEAT_MAX,
  CHORD_STEPS_MAX,
  CHORD_STEP_OCTAVE_MAX,
  ScaleSampler,
  chordAt,
  chordName,
  chordOf,
  hitStep,
  restStep,
  romanNumeral,
  scaleOffsets,
  voiceHit,
} from '@windsor/engine';

export { CHORD_STEPS_MAX };

/** What a tile carries, and what a drop writes: a hit of the current chord, or a rest. */
export type ChordPayload = { kind: 'hit' } | { kind: 'rest' };

export interface Chip {
  readonly payload: ChordPayload;
  /** `Hit` or `Rest`. */
  readonly name: string;
  /** The current chord's name and numeral under the Hit tile; empty for Rest. */
  readonly numeral: string;
}

export const REST_CHIP: Chip = { payload: { kind: 'rest' }, name: 'Rest', numeral: '' };

/** The chord the song holds at `tick` — the engine's timeline rule, for the tile and the audition. */
export function currentChord(
  harmony: Harmony,
  songTicks: number,
  tick: number,
): HarmonyChord | null {
  return chordAt(harmony, songTicks, tick);
}

/** `C min i`, from the harmony's key; empty with no chord. */
export function chordLabel(harmony: Harmony, chord: HarmonyChord | null): string {
  if (!chord) return '';
  const offsets = scaleOffsets(harmony.scale);
  const named = chordOf(offsets, chord.event.degree, chord.event.size);
  return `${chordName(harmony.root, named)} ${romanNumeral(chord.event.degree, named.quality, offsets.length)}`;
}

/** The Hit tile: named for the chord under the playhead now. */
export function hitChip(harmony: Harmony, chord: HarmonyChord | null): Chip {
  return { payload: { kind: 'hit' }, name: 'Hit', numeral: chordLabel(harmony, chord) };
}

/** A step's tile reads `Hit` or `Rest`: the chord is the timeline's, not the step's. */
export function stepLabel(step: ChordStep): string {
  return step.kind === 'hit' ? 'Hit' : 'Rest';
}

/** The notes a tile sounds when pressed: the current chord as the sequencer would play `step`; none for a rest or no chord. */
export function stepNotes(
  harmony: Harmony,
  chord: HarmonyChord | null,
  step: Pick<ChordHitStep, 'inversion' | 'octave'> | ChordStep,
  spec: Pick<ChordSpec, 'voicing' | 'register'>,
): number[] {
  if (!chord || ('kind' in step && step.kind === 'rest')) return [];
  const hit = 'kind' in step ? step : hitStep(step);
  const config = { ...spec, divisor: 1, gate: 1, steps: [] };
  return voiceHit(new ScaleSampler(harmony), config, hit, chord);
}

/** The notes the Hit tile sounds: the current chord in root position at the register. */
export function auditionNotes(
  harmony: Harmony,
  chord: HarmonyChord | null,
  payload: ChordPayload,
  spec: Pick<ChordSpec, 'voicing' | 'register'>,
): number[] {
  return payload.kind === 'rest' ? [] : stepNotes(harmony, chord, hitStep(), spec);
}

/** The step a drop writes: a root-position hit or a rest, over the step's timing. */
export function droppedStep(payload: ChordPayload, over?: ChordStep): ChordStep {
  const timing = over ? { duration: over.duration, repeat: over.repeat } : {};
  return payload.kind === 'rest' ? restStep(timing) : hitStep(timing);
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

/** A copy of the last step appended (a hit on an empty list); a full list is unchanged. */
export function appendStep(steps: readonly ChordStep[]): ChordStep[] {
  if (steps.length >= CHORD_STEPS_MAX) return [...steps];
  const last = steps[steps.length - 1];
  return [...steps, last ? { ...last } : hitStep()];
}

/** The list without its last step; an empty list stays empty. */
export function removeLast(steps: readonly ChordStep[]): ChordStep[] {
  return steps.slice(0, -1);
}

/** The per-step fields a cell turns, and how far each goes. Semi went with the step's pitch (#705). */
export type StepDial = 'octave' | 'inversion' | 'duration' | 'repeat';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** A hit-only edit; a rest is returned unchanged. */
function editHit(step: ChordStep, edit: (hit: ChordHitStep) => ChordHitStep): ChordStep {
  return step.kind === 'hit' ? edit(step) : step;
}

/**
 * Turn one dial by `direction`: octave stops at its bounds, inversion wraps
 * past `CHORD_INVERSION_MAX` back to 0 (so a click cycles it), duration walks
 * the table, repeat counts 1–`CHORD_REPEAT_MAX`. Octave and inversion are
 * hit-only; a rest keeps its timing dials.
 */
export function turnDial(step: ChordStep, dial: StepDial, direction: 1 | -1): ChordStep {
  switch (dial) {
    case 'octave':
      return editHit(step, (h) => ({
        ...h,
        octave: clamp(h.octave + direction, -CHORD_STEP_OCTAVE_MAX, CHORD_STEP_OCTAVE_MAX),
      }));
    case 'inversion': {
      const span = CHORD_INVERSION_MAX + 1;
      return editHit(step, (h) => ({
        ...h,
        inversion: (((h.inversion + direction) % span) + span) % span,
      }));
    }
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
  if (step.kind !== 'hit') return '';
  if (dial === 'inversion') return `inv ${step.inversion}`;
  const value = step.octave;
  if (value === 0) return 'oct';
  return `${value > 0 ? '+' : ''}${value}`;
}
