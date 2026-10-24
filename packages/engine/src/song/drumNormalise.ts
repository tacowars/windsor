/**
 * A Drum part's sequencer, normalised (windsor#948, record
 * `2026-10-24-drum-sequencer` decisions 2 and 3): every field its default
 * when absent, clamped or reported when junk, so building a `DrumSequencer`
 * from it cannot throw. A hit's `velocity` of 1, `pitch` of 0 and `ratchet`
 * of 1 leave no key, so an export carries no default. A new part (no
 * steps) is one bar of sixteenths in the song's meter, four on the floor.
 */
import { GATE_MIN, GRID_STEPS_MAX, MIDI_NOTE_MAX, RATCHET_MAX } from '../audioConstants';
import { DRUM_PITCH_MAX } from '../sequencing/drumConstants';
import { DEFAULT_DRUM_CONFIG } from '../sequencing/drumSequencer';
import { DRUM_STEP_KINDS, defaultDrumSteps, type DrumStep } from '../sequencing/drumSteps';
import type { DrumDriver } from './arrangement';
import { show, type FieldNormaliser } from './arrangementFields';
import { STEP_VARIATION_KEYS, stepVariationFields } from './performerNormalise';
import { seed, stepModLanes, unpitchedStep } from './sequencerFields';

const DRUM_KEYS = [
  'divisor',
  'steps',
  'length',
  'note',
  'gate',
  'accentVelocity',
  'accentMod',
  ...STEP_VARIATION_KEYS,
  'seed',
  'lanes',
];

export function drumDriver(raw: unknown, path: string, n: FieldNormaliser): DrumDriver {
  const d = DEFAULT_DRUM_CONFIG;
  const o = n.section(raw, path);
  n.dropUnknown(o, DRUM_KEYS, path);
  const steps = drumSteps(o.steps, `${path}.steps`, n);
  return {
    divisor: n.divisor(o.divisor, d.divisor, `${path}.divisor`),
    steps,
    // The whole line unless the document says shorter; never past the steps written.
    length: n.int(o.length, steps.length, 1, steps.length, `${path}.length`),
    note: n.int(o.note, d.note, 0, MIDI_NOTE_MAX, `${path}.note`),
    gate: n.num(o.gate, d.gate, GATE_MIN, 1, `${path}.gate`),
    accentVelocity: n.num(o.accentVelocity, d.accentVelocity, 0, 1, `${path}.accentVelocity`),
    accentMod: n.num(o.accentMod, d.accentMod, 0, 1, `${path}.accentMod`),
    ...stepVariationFields(o, path, n),
    seed: seed(o.seed, `${path}.seed`, n),
    lanes: stepModLanes(o.lanes, steps.length, `${path}.lanes`, n),
  };
}

/** 1–32 steps. An absent or junk list is the default bar; an over-long one is capped, reported. */
function drumSteps(raw: unknown, path: string, n: FieldNormaliser): DrumStep[] {
  if (raw === undefined) return defaultDrumSteps(n.meter);
  if (!Array.isArray(raw) || raw.length === 0) {
    n.correction(`${path}: ${show(raw)} is not a list of steps — using the default bar`);
    return defaultDrumSteps(n.meter);
  }
  const capped: unknown[] = raw.length > GRID_STEPS_MAX ? raw.slice(0, GRID_STEPS_MAX) : raw;
  if (capped.length !== raw.length) {
    n.correction(`${path}: ${raw.length} steps capped to ${GRID_STEPS_MAX}`);
  }
  return capped.map((step, i) => drumStep(step, `${path}[${i}]`, n));
}

/** A rest, or a hit: its accent, and its velocity, pitch and ratchet where they differ from a plain hit's. */
function drumStep(raw: unknown, path: string, n: FieldNormaliser): DrumStep {
  const o = n.section(raw, path);
  const kind = n.pick(o.kind, DRUM_STEP_KINDS, 'hit', `${path}.kind`);
  if (kind === 'rest') return unpitchedStep(o, kind, path, n);
  n.dropUnknown(o, ['kind', 'velocity', 'accent', 'pitch', 'ratchet'], path);
  const velocity = n.num(o.velocity, 1, 0, 1, `${path}.velocity`);
  const pitch = n.int(o.pitch, 0, -DRUM_PITCH_MAX, DRUM_PITCH_MAX, `${path}.pitch`);
  const ratchet = n.int(o.ratchet, 1, 1, RATCHET_MAX, `${path}.ratchet`);
  return {
    kind,
    accent: n.bool(o.accent, false, `${path}.accent`),
    ...(velocity !== 1 && { velocity }),
    ...(pitch !== 0 && { pitch }),
    ...(ratchet !== 1 && { ratchet }),
  };
}
