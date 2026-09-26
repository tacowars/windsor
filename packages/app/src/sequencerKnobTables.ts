/**
 * The Sequencers tab's knob specs (#618): every knob a card builds over a
 * part or its sequencer, as data. A default is the engine's — the kind's
 * `DEFAULT_*_CONFIG`, or the normaliser's constant for a field outside the
 * generator (`note`, `hold`, `velocity`) — never a copy of it: the Euclidean
 * card once carried `{ min: 2, max: 9, start: 4 }` while the sequencer starts
 * at `{ min: 3, max: 9, start: 5 }`, so a double-click reset put a value into
 * the document the engine would never choose (#617). `knobDefaults.test.ts`
 * holds every entry to its engine default.
 */
import type {
  DensityMod,
  DensityModKind,
  MusicPart,
  SequencerSpec,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  DEFAULT_CHORD_CONFIG,
  DEFAULT_EUCLIDEAN_CONFIG,
  DEFAULT_GRID_CONFIG,
  EUCLID_STEPS_MAX,
  GATE_MIN,
  GRID_STEPS_MAX,
  HOLD_DEFAULT,
  HOLD_MIN,
  LFO_BARS_DEFAULT,
  LFO_BARS_MIN,
  LFO_HZ_DEFAULT,
  MIDI_MIDDLE_C,
  VELOCITY_DEFAULT,
  WALK_CHANCE,
} from '../../../packages/client/src/audio/index-for-editor';
import { fmt0, fmt2, fmtMs, noteName } from './consoleFormat';
import type { PulseField } from './euclidModel';
import { GRID_ROTATE_MAX } from './gridConstants';
import type { KnobSpec } from './knob';

type KeysOfUnion<T> = T extends unknown ? keyof T : never;
/** A field of some sequencer spec, `kind` aside: what a driver knob may address (#618 decision 8). */
export type SequencerField = Exclude<KeysOfUnion<SequencerSpec>, 'kind'>;
/** A numeric field of the part itself: what a section knob may address. */
export type PartNumberField = {
  [K in keyof MusicPart]: MusicPart[K] extends number ? K : never;
}[keyof MusicPart];

/** A knob's range, default and readout; the binding is the card's. */
export type SeqKnobOpts = Pick<KnobSpec, 'min' | 'max' | 'def' | 'step' | 'curve' | 'fmt'>;
export interface DriverKnobEntry {
  readonly kind: 'driver';
  readonly f: SequencerField;
  readonly label: string;
  readonly o: SeqKnobOpts;
}
export interface SectionKnobEntry {
  readonly kind: 'section';
  readonly f: PartNumberField;
  readonly label: string;
  readonly o: SeqKnobOpts;
}
export type SequencerKnobEntry = DriverKnobEntry | SectionKnobEntry;
/** A knob a card binds itself (Steps, Rotate, Length, the `k` bounds): the spec without the binding. */
export type CardKnobSpec = SeqKnobOpts & Pick<KnobSpec, 'label'>;

const fmtSignedInt = (v: number): string => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0));

/** The part's velocity, on every card. */
export const VELOCITY_KNOB: SectionKnobEntry = {
  kind: 'section',
  f: 'velocity',
  label: 'Vel',
  o: { min: 0, max: 1, def: VELOCITY_DEFAULT, fmt: fmt2 },
};

/** The Euclidean card's note range: two octaves under middle C to three above. */
export const EUCLID_NOTE_MIN = 24;
export const EUCLID_NOTE_MAX = 96;
/** Its hold knob stops at two seconds; the engine accepts more from a file. */
export const EUCLID_HOLD_MAX = 2;

export const EUCLID_KNOBS: readonly SequencerKnobEntry[] = [
  {
    kind: 'driver',
    f: 'note',
    label: 'Note',
    o: { min: EUCLID_NOTE_MIN, max: EUCLID_NOTE_MAX, def: MIDI_MIDDLE_C, step: 1, fmt: noteName },
  },
  VELOCITY_KNOB,
  {
    kind: 'driver',
    f: 'hold',
    label: 'Hold',
    o: { min: HOLD_MIN, max: EUCLID_HOLD_MAX, def: HOLD_DEFAULT, curve: 'log', fmt: fmtMs },
  },
];

export const EUCLID_STEPS_KNOB: CardKnobSpec = {
  label: 'Steps n',
  min: 1,
  max: EUCLID_STEPS_MAX,
  def: DEFAULT_EUCLIDEAN_CONFIG.steps,
  step: 1,
  fmt: fmt0,
};

export const EUCLID_ROTATE_KNOB: CardKnobSpec = {
  label: 'Rotate',
  min: -EUCLID_STEPS_MAX,
  max: EUCLID_STEPS_MAX,
  def: DEFAULT_EUCLIDEAN_CONFIG.rotate,
  step: 1,
  fmt: fmt0,
};

/** The engine's own `k` bound, read rather than restated (#617). */
export const pulseDefault = (field: PulseField): number => DEFAULT_EUCLIDEAN_CONFIG.pulses[field];

export const euclidPulseKnob = (field: PulseField): CardKnobSpec => ({
  label: `k ${field}`,
  min: 0,
  max: EUCLID_STEPS_MAX,
  def: pulseDefault(field),
  step: 1,
  fmt: fmt0,
});

export const GRID_KNOBS: readonly SequencerKnobEntry[] = [
  VELOCITY_KNOB,
  {
    kind: 'driver',
    f: 'skipChance',
    label: 'Skip',
    o: { min: 0, max: 1, def: DEFAULT_GRID_CONFIG.skipChance, fmt: fmt2 },
  },
  {
    kind: 'driver',
    f: 'accentVelocity',
    label: 'Acc vel',
    o: { min: 0, max: 1, def: DEFAULT_GRID_CONFIG.accentVelocity, fmt: fmt2 },
  },
  {
    kind: 'driver',
    f: 'accentMod',
    label: 'Acc mod',
    o: { min: 0, max: 1, def: DEFAULT_GRID_CONFIG.accentMod, fmt: fmt2 },
  },
];

export const GRID_LENGTH_KNOB: CardKnobSpec = {
  label: 'Length',
  min: 1,
  max: GRID_STEPS_MAX,
  def: DEFAULT_GRID_CONFIG.length,
  step: 1,
  fmt: fmt0,
};

/** Rotate is the console's own: the document holds the rotated steps, so home is no turn at all. */
export const GRID_ROTATE_KNOB: CardKnobSpec = {
  label: 'Rotate',
  min: -GRID_ROTATE_MAX,
  max: GRID_ROTATE_MAX,
  def: 0,
  step: 1,
  fmt: fmtSignedInt,
};

export const CHORD_KNOBS: readonly SequencerKnobEntry[] = [
  VELOCITY_KNOB,
  {
    kind: 'driver',
    f: 'gate',
    label: 'Gate',
    o: { min: GATE_MIN, max: 1, def: DEFAULT_CHORD_CONFIG.gate, fmt: fmt2 },
  },
];

/** The density modulator's knob ranges: the console shows less than the engine accepts. */
export const DENSITY_BARS_MAX = 64;
export const DENSITY_HZ_MIN = 0.01;
export const DENSITY_HZ_MAX = 5;

const fmtHzRate = (v: number): string => `${v.toFixed(2)}H`;

/** What choosing a density kind writes: the engine's default modulator of that kind. */
export const DENSITY_DEFAULTS: Readonly<Record<DensityModKind, DensityMod>> = {
  lfoBars: { kind: 'lfoBars', bars: LFO_BARS_DEFAULT, shape: 'tri' },
  lfoHz: { kind: 'lfoHz', hz: LFO_HZ_DEFAULT, shape: 'tri' },
  walk: { kind: 'walk', stepChance: WALK_CHANCE },
};

/** The one knob each density kind has. */
export const DENSITY_KNOBS: Readonly<
  Record<DensityModKind, { f: 'bars' | 'hz' | 'stepChance'; label: string; o: SeqKnobOpts }>
> = {
  lfoBars: {
    f: 'bars',
    label: 'Bars',
    o: { min: LFO_BARS_MIN, max: DENSITY_BARS_MAX, def: LFO_BARS_DEFAULT, curve: 'log' },
  },
  lfoHz: {
    f: 'hz',
    label: 'Rate',
    o: {
      min: DENSITY_HZ_MIN,
      max: DENSITY_HZ_MAX,
      def: LFO_HZ_DEFAULT,
      curve: 'log',
      fmt: fmtHzRate,
    },
  },
  walk: { f: 'stepChance', label: 'Chance', o: { min: 0, max: 1, def: WALK_CHANCE, fmt: fmt2 } },
};
