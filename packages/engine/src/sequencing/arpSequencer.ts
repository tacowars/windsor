/**
 * The arpeggiator's config (#705; epic #703 decisions 12 and 13): the field
 * set the normaliser accepts, its defaults and the check every constructor
 * and live edit runs. The generator is `arpeggiator.ts` (#706); the step
 * grid's cells and cycle rule are `arpSteps.ts` (windsor#127).
 */
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  ARP_GATE_DEFAULT,
  ARP_OCTAVES_MAX,
  ARP_OCTAVES_MIN,
  ARP_REGISTER_OCTAVE_DEFAULT,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '../audioConstants';
import {
  CHORD_VOICING_DEFAULT,
  CHORD_VOICING_IDS,
  type ChordVoicingId,
} from '../harmony/chordTables';
import { assertArpGrid, defaultArpSteps, type ArpStep } from './arpSteps';
import { DIVISORS, isNoteDivisor } from './scheduler';
import type { StepModLane } from './stepModLanes';

export const ARP_STYLES = [
  'up',
  'down',
  'upDown',
  'downUp',
  'converge',
  'diverge',
  'conDiverge',
  'random',
  'randomOther',
  'randomOnce',
] as const;
export type ArpStyle = (typeof ARP_STYLES)[number];

export interface ArpSequencerConfig {
  style: ArpStyle;
  /** Ticks per arp step. Must divide the bar. */
  divisor: number;
  /** A note's length as a fraction of its step, in (0, 1]. */
  gate: number;
  /** Octaves the voiced chord is duplicated up before traversal, 1–4. */
  octaves: number;
  /** The Chord Player's voicing enum, applied once at the part's register. */
  voicing: ChordVoicingId;
  /** Restart the traversal on a chord change. */
  retrigger: boolean;
  /** Absolute MIDI octave (decision 11). */
  register: { octave: number };
  /**
   * The step grid (windsor#127, `arpSteps.ts`): exactly `ARP_STEPS_MAX`
   * cells, cell `k` shaping the `k`-th note of the style's cycle.
   */
  steps: readonly ArpStep[];
  /** Step modulation lanes, as the grid's: at most `STEP_MOD_LANES_MAX`, one value per cell. */
  lanes: readonly StepModLane[];
  /** The bump an accented cell adds to the part's velocity, as the grid's. */
  accentVelocity: number;
  /** The per-note mod an accented cell sends; a plain cell sends 0. */
  accentMod: number;
  /** Chance a note cell rests instead, 0–1. */
  skipChance: number;
  seed: number;
}

export const DEFAULT_ARP_CONFIG: ArpSequencerConfig = {
  style: 'up',
  divisor: DIVISORS.sixteenth,
  gate: ARP_GATE_DEFAULT,
  octaves: ARP_OCTAVES_MIN,
  voicing: CHORD_VOICING_DEFAULT,
  retrigger: false,
  register: { octave: ARP_REGISTER_OCTAVE_DEFAULT },
  steps: defaultArpSteps(),
  lanes: [],
  accentVelocity: ACCENT_VELOCITY_DEFAULT,
  accentMod: ACCENT_MOD_DEFAULT,
  skipChance: 0,
  seed: 0,
};

/** Every constructor and `reconfigure` check; the player runs it inside `plan`. */
export function assertArpConfig(config: ArpSequencerConfig): void {
  if (!ARP_STYLES.includes(config.style)) {
    throw new RangeError(`style must be one of ${ARP_STYLES.join('|')}`);
  }
  if (!isNoteDivisor(config.divisor)) {
    throw new RangeError(`divisor must divide the bar, got ${config.divisor}`);
  }
  if (!(config.gate > 0 && config.gate <= 1)) {
    throw new RangeError(`gate must be in (0, 1], got ${config.gate}`);
  }
  if (
    !Number.isInteger(config.octaves) ||
    config.octaves < ARP_OCTAVES_MIN ||
    config.octaves > ARP_OCTAVES_MAX
  ) {
    throw new RangeError(`octaves must be ${ARP_OCTAVES_MIN}..${ARP_OCTAVES_MAX}`);
  }
  if (!CHORD_VOICING_IDS.includes(config.voicing)) {
    throw new RangeError(`voicing must be one of ${CHORD_VOICING_IDS.join('|')}`);
  }
  const { octave } = config.register;
  if (!Number.isInteger(octave) || octave < REGISTER_OCTAVE_MIN || octave > REGISTER_OCTAVE_MAX) {
    throw new RangeError(`register.octave must be ${REGISTER_OCTAVE_MIN}..${REGISTER_OCTAVE_MAX}`);
  }
  assertArpGrid(config);
  if (!Number.isSafeInteger(config.seed)) throw new RangeError('seed must be a safe integer');
}
