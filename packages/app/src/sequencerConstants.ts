/**
 * The sequencer vocabulary the tabs share (#618): the kind labels, the step
 * divisors and the note names. Data, not logic — `sequencerKnobTables.ts`
 * holds the knob specs.
 */
import type { SequencerKind } from '../../../packages/client/src/audio/index-for-editor';
import { CHORD_NOTE_NAMES } from '../../../packages/client/src/audio/index-for-editor';

/** One spelling per kind, in the part list's picker and on each card's header. */
export const KIND_LABELS: Readonly<Record<SequencerKind, string>> = {
  none: 'None',
  euclidean: 'Euclidean',
  grid: 'Grid',
  chord: 'Chord',
  arp: 'Arp',
  bass: 'Bass',
};

/** The twelve pitch classes, sharps: the engine's own list, not a copy. */
export const NOTE_NAMES: readonly string[] = CHORD_NOTE_NAMES;

/** Step divisors of the 96-tick bar, longest first, with musician-facing names. */
export const DIVISOR_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '96', label: '1 bar' },
  { value: '48', label: '1/2' },
  { value: '32', label: '1/2T' },
  { value: '24', label: '1/4' },
  { value: '16', label: '1/4T' },
  { value: '12', label: '1/8' },
  { value: '8', label: '1/8T' },
  { value: '6', label: '1/16' },
  { value: '4', label: '1/16T' },
  { value: '3', label: '1/32' },
];
