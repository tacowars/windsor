/**
 * The Basslead strip without the DOM (windsor#371, record
 * `2026-10-01-sequencer-rack-devices` decision 9): what Length, Rotate and
 * Randomize write, the Steps label, and how a step's slide meets the note
 * before it, for the lanes. A step is the Arp's cell (`BassStep` is
 * `ArpStep`), so the cell edits are the Arp's and the Grid's
 * (`arpStepCells.ts`), and Rotate and Randomize are the Arp's over the
 * loop. Every function returns new values for `ctx.change`, where arrays
 * replace wholesale. Nothing here writes a pitch: the pitch mode picks it.
 */
import type { BassSpec, BassStep, StepModLane } from '@windsor/engine';
import { GRID_STEPS_MAX, TICKS_PER_BAR, bassNote } from '@windsor/engine';
import type { ArpRandomTable } from './arpGridConstants';
import { randomArpCells, rotateArp } from './arpGridModel';
import { BASS_BARS_DECIMALS, BASS_RANDOM } from './bassGridConstants';
import type { Draw } from './gridModel';
import { NO_SLIDE, type StepSlide, lanesForSteps } from './stepModLaneModel';

/** The strip fields Length, Rotate and Randomize read. */
export type BassStrip = Pick<BassSpec, 'steps' | 'length' | 'lanes'>;

/** What the Length knob writes: the loop, the steps and the lanes together. */
export interface BassLengthChange {
  length: number;
  steps: BassStep[];
  lanes: StepModLane[];
}

/**
 * Length (as the Grid's): the loop set to `length`, 1 to `GRID_STEPS_MAX`.
 * Past the written steps it pads them with plain notes and pads each lane
 * with 0; below them it trims the loop, and the steps and lane values past
 * it stay in the document, greyed on the strip, until the loop reaches
 * them again.
 */
export function bassLengthChange(spec: BassStrip, length: number): BassLengthChange {
  const loop = Math.max(1, Math.min(GRID_STEPS_MAX, Math.round(length)));
  const pad = Math.max(0, loop - spec.steps.length);
  const steps = [...spec.steps, ...Array.from({ length: pad }, () => bassNote())];
  return { length: loop, steps, lanes: lanesForSteps(spec.lanes, steps.length) };
}

/**
 * Rotate: the loop's steps turned `by` places, their lane values and
 * ratchets with them; the steps past the loop stay where they are. The
 * card applies the turn since its last value, so the document holds the
 * turned steps and no offset.
 */
export function rotateBass(
  spec: BassStrip,
  by: number,
): { steps: BassStep[]; lanes: StepModLane[] } {
  return rotateArp(spec, by, spec.length);
}

/**
 * Randomize, as the Grid's over every written step: each a rest, a tie or
 * a note with its octave, accent, slide and ratchet rerolled from `table`
 * (the Arp's draw, seven per step). A step holds no pitch, so none is
 * drawn; the lanes are not the steps', so nothing here reaches them.
 */
export function randomBassSteps(
  steps: readonly BassStep[],
  draw: Draw,
  table: ArpRandomTable = BASS_RANDOM,
): BassStep[] {
  return randomArpCells(steps, steps.length, draw, table);
}

/** The Steps label: the loop and the bars it spans at the rate, `16 · 2 bars`, `19 · 2.375 bars`. */
export function bassStepsLabel(
  length: number,
  divisor: number,
  ticksPerBar = TICKS_PER_BAR,
): string {
  const bars = Number(((length * divisor) / ticksPerBar).toFixed(BASS_BARS_DECIMALS));
  return `${length} · ${bars} ${bars === 1 ? 'bar' : 'bars'}`;
}

/**
 * How step `index`'s note meets the note before it (windsor#31,
 * `StepSlide`), for the lanes' held cells and readouts, read the way
 * `BassSequencer.strike` plays it: a slide onto the pitch held ties and
 * plays no lane value of its own. The note before it is the latest note in
 * the loop, walking back over ties; a rest before it holds nothing.
 *
 * `kind`: a Fixed bass plays one degree, so the two notes' octave shifts
 * decide it: `same` when they match, `retarget` when they differ. Follow
 * Root and Follow Chord draw the pitch from the chord under the step, which
 * the strip does not know: `either`.
 *
 * `when`: a held note that comes from wrapping round the loop is held only
 * once it wraps, since a region's entry holds nothing: `wrap`. With
 * Density below 1 the note before it may not sound: `skip`. Else `always`.
 */
export function bassSlideAt(
  spec: Pick<BassSpec, 'steps' | 'length' | 'density' | 'pitchMode'>,
  index: number,
): StepSlide {
  const { steps } = spec;
  const n = Math.max(1, Math.min(spec.length, steps.length));
  const step = steps[index];
  if (!step || step.kind !== 'note' || !step.slide || index >= n) return NO_SLIDE;
  for (let back = 1; back <= n; back++) {
    const prev = steps[(((index - back) % n) + n) % n];
    if (!prev || prev.kind === 'rest') return NO_SLIDE;
    if (prev.kind === 'tie') continue;
    const same = prev.octave === step.octave ? 'same' : 'retarget';
    const kind = spec.pitchMode === 'fixed' ? same : 'either';
    const when = back > index ? 'wrap' : spec.density < 1 ? 'skip' : 'always';
    return { kind, when };
  }
  return NO_SLIDE;
}
