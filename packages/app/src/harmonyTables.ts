/**
 * The Harmony tab's knob specs (#618): the root, the degree weights, and each
 * pitched part's register. A default is the engine's — the normaliser's root,
 * a uniform weight, the kind's `DEFAULT_*_CONFIG` register.
 */
import type { SequencerKind } from '../../../packages/client/src/audio/index-for-editor';
import {
  DEFAULT_ARPEGGIATOR_CONFIG,
  DEFAULT_CHORD_CONFIG,
  DEFAULT_GRID_CONFIG,
  DEFAULT_STEP_SEQUENCER_CONFIG,
  MIDI_MIDDLE_C,
  uniformWeights,
} from '../../../packages/client/src/audio/index-for-editor';
import { fmt0, fmt2, noteName } from './consoleFormat';
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

/** A degree's weight: the uniform set the engine starts a scale with is 1 per degree. */
export const WEIGHT_MAX = 4;
export const WEIGHT_KNOB: Omit<CardKnobSpec, 'label'> = {
  min: 0,
  max: WEIGHT_MAX,
  def: uniformWeights([0])[0] ?? 1,
  fmt: fmt2,
};

/** Octaves from the root a register may sit at, either way. */
export const REGISTER_OCTAVE_MAX = 4;
/** Octaves a drawn register may span. */
export const REGISTER_SPAN_MAX = 4;

/** The kinds with a register, and the octave each starts at in the engine. */
export const REGISTER_OCTAVE_DEFAULTS: Readonly<Partial<Record<SequencerKind, number>>> = {
  arp: DEFAULT_ARPEGGIATOR_CONFIG.register.octave,
  step: DEFAULT_STEP_SEQUENCER_CONFIG.register.octave,
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

/** The kinds that draw across a span: the arp and the step sequencer. */
export const REGISTER_SPAN_DEFAULTS: Readonly<Partial<Record<SequencerKind, number>>> = {
  arp: DEFAULT_ARPEGGIATOR_CONFIG.register.span,
  step: DEFAULT_STEP_SEQUENCER_CONFIG.register.span,
};

export const spanKnob = (kind: SequencerKind): CardKnobSpec => ({
  label: 'Span',
  min: 1,
  max: REGISTER_SPAN_MAX,
  def: REGISTER_SPAN_DEFAULTS[kind] ?? 1,
  step: 1,
  fmt: fmt0,
});
