/**
 * The Harmony tab's specs (#618, #705): the root as a pitch-class select,
 * and each pitched part's absolute register octave. A default is the
 * engine's — the normaliser's root, the kind's `DEFAULT_*_CONFIG` register,
 * the octave range `REGISTER_OCTAVE_MIN..MAX` (decision 11).
 */
import type { SequencerKind } from '../../../packages/client/src/audio/index-for-editor';
import {
  DEFAULT_ARP_CONFIG,
  DEFAULT_BASS_CONFIG,
  DEFAULT_CHORD_CONFIG,
  DEFAULT_GRID_CONFIG,
  PITCH_CLASS_MAX,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '../../../packages/client/src/audio/index-for-editor';
import { fmt0 } from './consoleFormat';
import type { CardKnobSpec } from './sequencerKnobTables';
import { NOTE_NAMES } from './sequencerConstants';

/** The normaliser's root when the document names none: C. */
export const ROOT_DEFAULT = 0;

/** The twelve pitch classes as the root select's options, in the engine's spelling. */
export const ROOT_OPTIONS: readonly { value: string; label: string }[] = NOTE_NAMES.slice(
  0,
  PITCH_CLASS_MAX + 1,
).map((name, pc) => ({ value: String(pc), label: name }));

/** The kinds with a register, and the octave each starts at in the engine. */
export const REGISTER_OCTAVE_DEFAULTS: Readonly<Partial<Record<SequencerKind, number>>> = {
  grid: DEFAULT_GRID_CONFIG.register.octave,
  chord: DEFAULT_CHORD_CONFIG.register.octave,
  arp: DEFAULT_ARP_CONFIG.register.octave,
  bass: DEFAULT_BASS_CONFIG.register.octave,
};

/** The Octave knob for a part of `kind`: absolute MIDI octaves, defaulting to where the engine puts that kind. */
export const octaveKnob = (kind: SequencerKind): CardKnobSpec => ({
  label: 'Octave',
  min: REGISTER_OCTAVE_MIN,
  max: REGISTER_OCTAVE_MAX,
  def: REGISTER_OCTAVE_DEFAULTS[kind] ?? DEFAULT_CHORD_CONFIG.register.octave,
  step: 1,
  fmt: fmt0,
});
