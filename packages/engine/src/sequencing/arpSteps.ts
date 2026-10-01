/**
 * The arp's step grid (windsor#127, epic windsor#126 decisions 1–4): the
 * cell type, its defaults, the check the arp's config runs over it, and the
 * cycle-length rule the cells are read against.
 *
 * Cell `k` shapes the `k`-th note of the style's cycle, not a fixed pitch,
 * so a cell has no degree: it is a rest, a tie, or a note with an octave
 * shift, an accent, a slide and a ratchet (windsor#366), as a grid step is
 * without its degree. The
 * grid always stores `ARP_STEPS_MAX` cells; the cycle over the chord under
 * the playhead reads the first `arpCycleLength(style, L)` of them, and the
 * cells past it wait, as the grid keeps steps past its length.
 *
 * The arpeggiator plays the cells (windsor#129, `arpCellPlay.ts`); a new
 * arp, every cell a plain note, sounds as it did before the grid.
 */
import { GRID_STEP_OCTAVE_MAX } from '../audioConstants';
import { ARP_BOUNCE_STYLES, ARP_STEPS_MAX } from './arpStepConstants';
import type { ArpStyle } from './arpSequencer';
import { GRID_STEP_KINDS, assertRatchet } from './gridSequencer';
import { assertStepModLanes, type StepModLane } from './stepModLanes';

export interface ArpNoteStep {
  readonly kind: 'note';
  /** Octaves the arp's pitch is shifted by, an integer within `±GRID_STEP_OCTAVE_MAX`. */
  readonly octave: number;
  readonly accent: boolean;
  readonly slide: boolean;
  /** Hits the cell's roll plays, 1 to `RATCHET_MAX` (windsor#366); absent is one. */
  readonly ratchet?: number;
}

export type ArpStep = { readonly kind: 'rest' } | { readonly kind: 'tie' } | ArpNoteStep;

/** A plain note cell: the arp's own pitch, unaccented, no slide. */
export function arpNote(over: Partial<Omit<ArpNoteStep, 'kind'>> = {}): ArpNoteStep {
  return { kind: 'note', octave: 0, accent: false, slide: false, ...over };
}

/** The cells a new arp starts with: every one a plain note, so it plays as an arp without a grid. */
export function defaultArpSteps(count = ARP_STEPS_MAX): ArpStep[] {
  return Array.from({ length: count }, () => arpNote());
}

/**
 * The cells one cycle of `style` spans over a note list of `listLength`
 * (epic decision 2): a bounce style walks up and back without repeating the
 * ends, `2L − 2` cells when `L > 2`; every other style, and a bounce over
 * one or two notes, is `L`.
 */
export function arpCycleLength(
  style: ArpStyle,
  listLength: number,
  bounceStyles: readonly ArpStyle[] = ARP_BOUNCE_STYLES,
): number {
  return bounceStyles.includes(style) && listLength > 2 ? 2 * listLength - 2 : listLength;
}

/** The grid fields of an arp's config: what `assertArpGrid` checks. */
export interface ArpGridFields {
  readonly steps: readonly ArpStep[];
  readonly lanes: readonly StepModLane[];
  readonly accentVelocity: number;
  readonly accentMod: number;
  readonly skipChance: number;
}

function assertCell(step: ArpStep, index: number): void {
  if (!(GRID_STEP_KINDS as readonly string[]).includes(step.kind)) {
    throw new RangeError(`steps[${index}].kind must be one of ${GRID_STEP_KINDS.join('|')}`);
  }
  if (step.kind !== 'note') return;
  if (!Number.isInteger(step.octave) || Math.abs(step.octave) > GRID_STEP_OCTAVE_MAX) {
    throw new RangeError(
      `steps[${index}].octave must be an integer within ±${GRID_STEP_OCTAVE_MAX}`,
    );
  }
  assertRatchet(step.ratchet, `steps[${index}]`);
}

function assertUnit(value: number, name: string): void {
  if (!(value >= 0 && value <= 1)) throw new RangeError(`${name} must be in [0, 1], got ${value}`);
}

/**
 * Exactly `ARP_STEPS_MAX` valid cells, the lanes the grid allows with one
 * value per cell, and the accent and skip amounts in 0–1: the bounds the
 * normaliser (`performerNormalise.ts`) makes a document meet.
 */
export function assertArpGrid(config: ArpGridFields): void {
  if (config.steps.length !== ARP_STEPS_MAX) {
    throw new RangeError(`steps must hold ${ARP_STEPS_MAX} cells, got ${config.steps.length}`);
  }
  config.steps.forEach(assertCell);
  assertStepModLanes(config.lanes);
  config.lanes.forEach((lane, i) => {
    if (lane.values.length !== ARP_STEPS_MAX) {
      throw new RangeError(`lanes[${i}].values must hold ${ARP_STEPS_MAX} values`);
    }
  });
  assertUnit(config.accentVelocity, 'accentVelocity');
  assertUnit(config.accentMod, 'accentMod');
  assertUnit(config.skipChance, 'skipChance');
}
