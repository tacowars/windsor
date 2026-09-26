/**
 * The arpeggiator's config and a silent stub of its generator (#705; the
 * generator itself arrives with #706 — epic #703 decisions 12 and 13).
 *
 * The normaliser accepts the whole field set here so a v3 document can
 * carry an `arp` part before the performer exists; the stub subscribes at
 * the part's divisor, emits nothing and holds nothing, so the player's
 * binding, the region gate and the console's card have their seam today.
 */
import {
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
import type { NoteEvent, NoteHandler } from './noteEvent';
import type { PartTickEvent, PartTickSource } from './regionGate';
import { DIVISORS, isBarDivisor, type Unsubscribe } from './scheduler';

export const ARP_STYLES = [
  'up',
  'down',
  'upDown',
  'downUp',
  'converge',
  'diverge',
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
  seed: 0,
};

/** Every constructor and `reconfigure` check; the player runs it inside `plan`. */
export function assertArpConfig(config: ArpSequencerConfig): void {
  if (!ARP_STYLES.includes(config.style)) {
    throw new RangeError(`style must be one of ${ARP_STYLES.join('|')}`);
  }
  if (!isBarDivisor(config.divisor)) {
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
  if (!Number.isSafeInteger(config.seed)) throw new RangeError('seed must be a safe integer');
}

/** The stub: subscribed, silent. #706 replaces the body, not the surface. */
export class ArpSequencer {
  onNote: NoteHandler | null = null;
  private current: ArpSequencerConfig;

  constructor(config: ArpSequencerConfig) {
    assertArpConfig(config);
    this.current = config;
  }

  get config(): ArpSequencerConfig {
    return this.current;
  }

  reconfigure(config: ArpSequencerConfig): void {
    assertArpConfig(config);
    this.current = config;
  }

  /** The region gate entered a region: the stream restarts here (#706). */
  enter(_regionIndex: number): void {}

  /** No position to show until #706. */
  stepAt(_localStep: number): number {
    return -1;
  }

  attach(source: PartTickSource): Unsubscribe {
    return source.subscribe(this.current.divisor, (event) => this.handleTick(event));
  }

  handleTick(_event: PartTickEvent): NoteEvent[] {
    return [];
  }

  release(_tick: number, _time: number): NoteEvent[] {
    return [];
  }
}
