/**
 * The arpeggiator's and the bass's sequencer fields, normalised (#705):
 * the `arp` and `bass` branches of `normaliseSequencer`. Complete here so a
 * v3 document carries either kind today; #706 and #707 add the generator
 * and the card, not a field. Everything returned satisfies `assertArpConfig`
 * / `assertBassConfig` by construction.
 *
 * The arp's step grid (windsor#127) takes the grid's rules: a cell as a grid
 * step without its degree, its ratchet included (windsor#366), the grid's lanes, accent and skip ranges. Its
 * cells are always exactly `ARP_STEPS_MAX`: an absent list is every cell a
 * plain note, silently; a short, long or junk one is padded with plain notes
 * or trimmed, reported.
 *
 * Basslead's step strip (windsor#367) takes the same cell and the Grid's
 * list rules: 1–`GRID_STEPS_MAX` steps, a `length` within them, lanes one
 * value per step. A bass written without steps gets one bar of plain notes
 * at its divisor, silently, and plays as it did before the strip.
 */
import {
  ARP_OCTAVES_MAX,
  ARP_OCTAVES_MIN,
  GATE_MIN,
  GRID_STEPS_MAX,
  HARMONY_DEGREE_MAX,
} from '../audioConstants';
import { CHORD_VOICING_DEFAULT, CHORD_VOICING_IDS } from '../harmony/chordTables';
import { ARP_STYLES, DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { ARP_STEPS_MAX } from '../sequencing/arpStepConstants';
import { arpNote, defaultArpSteps, type ArpStep } from '../sequencing/arpSteps';
import {
  BASS_PITCH_MODES,
  DEFAULT_BASS_CONFIG,
  defaultBassSteps,
  type BassStep,
} from '../sequencing/bassSequencer';
import type { ArpDriver, BassDriver } from './arrangement';
import { GRID_STEP_KINDS } from '../sequencing/gridSequencer';
import { show, type FieldNormaliser } from './arrangementFields';
import {
  registerOctave,
  seed,
  STEP_NOTE_KEYS,
  stepModLanes,
  stepNoteFields,
  unpitchedStep,
} from './sequencerFields';

const ARP_KEYS = [
  'style',
  'divisor',
  'gate',
  'octaves',
  'voicing',
  'retrigger',
  'register',
  'steps',
  'lanes',
  'accentVelocity',
  'accentMod',
  'skipChance',
  'seed',
];

export function arpDriver(raw: unknown, path: string, n: FieldNormaliser): ArpDriver {
  const d = DEFAULT_ARP_CONFIG;
  const o = n.section(raw, path);
  n.dropUnknown(o, ARP_KEYS, path);
  return {
    style: n.pick(o.style, ARP_STYLES, d.style, `${path}.style`),
    divisor: n.divisor(o.divisor, d.divisor, `${path}.divisor`),
    gate: n.num(o.gate, d.gate, GATE_MIN, 1, `${path}.gate`),
    octaves: n.int(o.octaves, d.octaves, ARP_OCTAVES_MIN, ARP_OCTAVES_MAX, `${path}.octaves`),
    voicing: n.pick(o.voicing, CHORD_VOICING_IDS, CHORD_VOICING_DEFAULT, `${path}.voicing`),
    retrigger: n.bool(o.retrigger, d.retrigger, `${path}.retrigger`),
    register: registerOctave(o.register, d.register.octave, `${path}.register`, n),
    steps: arpSteps(o.steps, `${path}.steps`, n),
    lanes: stepModLanes(o.lanes, ARP_STEPS_MAX, `${path}.lanes`, n),
    accentVelocity: n.num(o.accentVelocity, d.accentVelocity, 0, 1, `${path}.accentVelocity`),
    accentMod: n.num(o.accentMod, d.accentMod, 0, 1, `${path}.accentMod`),
    skipChance: n.num(o.skipChance, d.skipChance, 0, 1, `${path}.skipChance`),
    seed: seed(o.seed, `${path}.seed`, n),
  };
}

/** Exactly `ARP_STEPS_MAX` cells: absent is every cell a plain note; otherwise padded or trimmed, reported. */
function arpSteps(raw: unknown, path: string, n: FieldNormaliser): ArpStep[] {
  if (raw === undefined) return defaultArpSteps();
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of steps — every step a plain note`);
    return defaultArpSteps();
  }
  if (raw.length !== ARP_STEPS_MAX) {
    n.correction(`${path}: ${raw.length} steps for ${ARP_STEPS_MAX} — resized with plain notes`);
  }
  return Array.from({ length: ARP_STEPS_MAX }, (_, i) =>
    i < raw.length ? arpStep(raw[i], `${path}[${i}]`, n) : arpNote(),
  );
}

/** A grid step without its degree: a rest, a tie, or a note with octave, accent, slide and ratchet. */
function arpStep(raw: unknown, path: string, n: FieldNormaliser): ArpStep {
  const o = n.section(raw, path);
  const kind = n.pick(o.kind, GRID_STEP_KINDS, 'note', `${path}.kind`);
  if (kind !== 'note') return unpitchedStep(o, kind, path, n);
  n.dropUnknown(o, ['kind', ...STEP_NOTE_KEYS], path);
  return arpNote(stepNoteFields(o, path, n));
}

const BASS_KEYS = [
  'pitchMode',
  'rootBias',
  'fixedDegree',
  'divisor',
  'gate',
  'register',
  'density',
  'seed',
  'steps',
  'length',
  'accentVelocity',
  'accentMod',
  'lanes',
];

export function bassDriver(raw: unknown, path: string, n: FieldNormaliser): BassDriver {
  const d = DEFAULT_BASS_CONFIG;
  const o = n.section(raw, path);
  n.dropUnknown(o, BASS_KEYS, path);
  const head = {
    pitchMode: n.pick(o.pitchMode, BASS_PITCH_MODES, d.pitchMode, `${path}.pitchMode`),
    rootBias: n.num(o.rootBias, d.rootBias, 0, 1, `${path}.rootBias`),
    fixedDegree: n.int(o.fixedDegree, d.fixedDegree, 0, HARMONY_DEGREE_MAX, `${path}.fixedDegree`),
    divisor: n.divisor(o.divisor, d.divisor, `${path}.divisor`),
    gate: n.num(o.gate, d.gate, GATE_MIN, 1, `${path}.gate`),
    register: registerOctave(o.register, d.register.octave, `${path}.register`, n),
    density: n.num(o.density, d.density, 0, 1, `${path}.density`),
    seed: seed(o.seed, `${path}.seed`, n),
  };
  return { ...head, ...bassStrip(o, head.divisor, path, n) };
}

type BassStripFields = Pick<
  BassDriver,
  'steps' | 'length' | 'accentVelocity' | 'accentMod' | 'lanes'
>;

/**
 * Basslead's step strip (windsor#367), by the Grid's rules: `length` fitted
 * to the steps written, the lanes to the steps, the accents to 0–1. Absent
 * steps are one bar of plain notes at the part's divisor, silently, which
 * plays as the Basslead did before the strip.
 */
function bassStrip(
  o: Record<string, unknown>,
  divisor: number,
  path: string,
  n: FieldNormaliser,
): BassStripFields {
  const d = DEFAULT_BASS_CONFIG;
  const steps = bassSteps(o.steps, divisor, `${path}.steps`, n);
  return {
    steps,
    length: n.int(o.length, steps.length, 1, steps.length, `${path}.length`),
    accentVelocity: n.num(o.accentVelocity, d.accentVelocity, 0, 1, `${path}.accentVelocity`),
    accentMod: n.num(o.accentMod, d.accentMod, 0, 1, `${path}.accentMod`),
    lanes: stepModLanes(o.lanes, steps.length, `${path}.lanes`, n),
  };
}

/** 1–`GRID_STEPS_MAX` Arp cells. Absent is a bar of plain notes; junk is too, reported; an over-long list is capped, reported. */
function bassSteps(raw: unknown, divisor: number, path: string, n: FieldNormaliser): BassStep[] {
  if (raw === undefined) return defaultBassSteps(divisor);
  if (!Array.isArray(raw) || raw.length === 0) {
    n.correction(`${path}: ${show(raw)} is not a list of steps — using a bar of plain notes`);
    return defaultBassSteps(divisor);
  }
  const capped: unknown[] = raw.length > GRID_STEPS_MAX ? raw.slice(0, GRID_STEPS_MAX) : raw;
  if (capped.length !== raw.length) {
    n.correction(`${path}: ${raw.length} steps capped to ${GRID_STEPS_MAX}`);
  }
  return capped.map((step, i) => arpStep(step, `${path}[${i}]`, n));
}
