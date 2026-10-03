/**
 * The register knob's spec (#618, #705): each pitched part's absolute
 * register octave, drawn by the arp and bass cards as Reg (#706, #707) and
 * by the Song view's detail pane for the kinds whose card has none (#709).
 * A default is the engine's — the kind's `DEFAULT_*_CONFIG` register, the
 * octave range `REGISTER_OCTAVE_MIN..MAX` (decision 11); the key root moved
 * to the transport strip with #708 (`transportTables.ts`'s `KEY_OPTIONS`).
 */
import type { SequencerKind } from '@windsor/engine';
import {
  DEFAULT_ARP_CONFIG,
  DEFAULT_BASS_CONFIG,
  DEFAULT_CHORD_CONFIG,
  DEFAULT_FIGURE_CONFIG,
  DEFAULT_GRID_CONFIG,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '@windsor/engine';
import { fmt0 } from './consoleFormat';
import type { CardKnobSpec } from './sequencerKnobTables';

/** The kinds with a register, and the octave each starts at in the engine. */
export const REGISTER_OCTAVE_DEFAULTS: Readonly<Partial<Record<SequencerKind, number>>> = {
  grid: DEFAULT_GRID_CONFIG.register.octave,
  chord: DEFAULT_CHORD_CONFIG.register.octave,
  arp: DEFAULT_ARP_CONFIG.register.octave,
  bass: DEFAULT_BASS_CONFIG.register.octave,
  figure: DEFAULT_FIGURE_CONFIG.register.octave,
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
