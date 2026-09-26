/**
 * The Harmony tab's knob specs (#618): the root and each pitched part's
 * register octave. A default is the engine's — the normaliser's root, the
 * kind's `DEFAULT_*_CONFIG` register.
 */
import type { SequencerKind } from '../../../packages/client/src/audio/index-for-editor';
import {
  DEFAULT_CHORD_CONFIG,
  DEFAULT_GRID_CONFIG,
  MIDI_MIDDLE_C,
} from '../../../packages/client/src/audio/index-for-editor';
import { fmt0, noteName } from './consoleFormat';
import type { CardKnobSpec } from './sequencerKnobTables';

/** The root knob's reach: C1 to C6 around the engine's middle-C default. */
export const ROOT_MIN = 24;
export const ROOT_MAX = 84;

export const ROOT_KNOB: CardKnobSpec = {
  label: 'Root',
  min: ROOT_MIN,
  max: ROOT_MAX,
  def: MIDI_MIDDLE_C,
  step: 1,
  fmt: noteName,
};

/** Octaves from the root a register may sit at, either way. */
export const REGISTER_OCTAVE_MAX = 4;

/** The kinds with a register, and the octave each starts at in the engine. */
export const REGISTER_OCTAVE_DEFAULTS: Readonly<Partial<Record<SequencerKind, number>>> = {
  grid: DEFAULT_GRID_CONFIG.register.octave,
  chord: DEFAULT_CHORD_CONFIG.register.octave,
};

/** The Octave knob for a part of `kind`, defaulting to where the engine puts that kind. */
export const octaveKnob = (kind: SequencerKind): CardKnobSpec => ({
  label: 'Octave',
  min: -REGISTER_OCTAVE_MAX,
  max: REGISTER_OCTAVE_MAX,
  def: REGISTER_OCTAVE_DEFAULTS[kind] ?? 0,
  step: 1,
  fmt: fmt0,
});
