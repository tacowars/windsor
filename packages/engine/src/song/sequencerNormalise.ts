/**
 * A part's sequencer, normalised (#597): the tagged union behind
 * `DocumentPart.sequencer` and the driver fields of each kind. Everything
 * returned satisfies the generator constructors' asserted ranges by
 * construction — integers where integers are required, divisors that divide
 * the 96-tick bar, gates in (0, 1] — so building a generator from it cannot
 * throw. `ArrangementNormaliser` (`arrangementNormalise.ts`) calls it per part.
 */
import { chordDriver } from '../harmony/chordNormalise';
import type {
  EuclideanDriver,
  GridDriver,
  RegionPattern,
  SequencerKind,
  SequencerSpec,
} from './arrangement';
import { arpDriver, bassDriver } from './performerNormalise';
import {
  cycledStepModLanes,
  drawnLane,
  registerOctave,
  seed,
  STEP_NOTE_KEYS,
  stepModLanes,
  stepNoteFields,
  unpitchedStep,
} from './sequencerFields';
import { SEEDED_KINDS, SEQUENCER_KINDS } from './arrangement';
import { isRecord, show, type FieldNormaliser } from './arrangementFields';
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  EUCLID_PITCH_LANE_MAX,
  EUCLID_RATCHET_MAX,
  EUCLID_STEPS_MAX,
  GRID_DEGREE_MAX,
  GRID_STEPS_MAX,
  HOLD_DEFAULT,
  HOLD_MAX,
  HOLD_MIN,
  LFO_BARS_DEFAULT,
  LFO_BARS_MAX,
  LFO_BARS_MIN,
  LFO_HZ_DEFAULT,
  LFO_HZ_MAX,
  MIDI_MIDDLE_C,
  MIDI_NOTE_MAX,
  WALK_CHANCE,
} from '../audioConstants';
import {
  DEFAULT_EUCLIDEAN_CONFIG,
  DENSITY_MOD_KINDS,
  LFO_SHAPES,
  type DensityMod,
} from '../sequencing/euclideanSequencer';
import { EUCLID_ROW_KEYS, type EuclidRows } from '../sequencing/euclidLanes';
import {
  DEFAULT_GRID_CONFIG,
  GRID_STEP_KINDS,
  defaultGridSteps,
  gridNote,
  type GridStep,
} from '../sequencing/gridSequencer';

/** The tagged sequencer; an absent or unknown kind is `none`, which is inert. */
export function normaliseSequencer(raw: unknown, path: string, n: FieldNormaliser): SequencerSpec {
  const o = n.section(raw, path);
  const kind = n.pick(o.kind, SEQUENCER_KINDS, 'none', `${path}.kind`);
  const driver = { ...o };
  delete driver.kind;
  switch (kind) {
    case 'euclidean': {
      const notes = { note: driver.note, hold: driver.hold };
      delete driver.note;
      delete driver.hold;
      return {
        kind,
        note: n.int(notes.note, MIDI_MIDDLE_C, 0, MIDI_NOTE_MAX, `${path}.note`),
        hold: n.num(notes.hold, HOLD_DEFAULT, HOLD_MIN, HOLD_MAX, `${path}.hold`),
        ...euclideanDriver(driver, path, n),
      };
    }
    case 'chord':
      return { kind, ...chordDriver(driver, path, n) };
    case 'grid':
      return { kind, ...gridDriver(driver, path, n) };
    case 'arp':
      return { kind, ...arpDriver(driver, path, n) };
    case 'bass':
      return { kind, ...bassDriver(driver, path, n) };
    default:
      n.dropUnknown(driver, [], path);
      return { kind: 'none' };
  }
}

/**
 * The kind `normaliseSequencer` settles on for `raw`, read without a report:
 * what a part's regions normalise their patterns against before the
 * sequencer itself is normalised (and reported) in its usual place.
 */
export function sequencerKindOf(raw: unknown): SequencerKind {
  const kind = isRecord(raw) ? raw.kind : undefined;
  return (SEQUENCER_KINDS as readonly unknown[]).includes(kind) ? (kind as SequencerKind) : 'none';
}

/**
 * A region's own pattern (windsor#73): absent stays absent, so a region
 * without one plays the part's `sequencer` and nothing is ever copied in.
 * One of another kind than the part's is dropped, reported; a `seed` inside
 * one is dropped silently (the seed is the part's). Everything else gets
 * exactly the rules `part.sequencer` gets for that kind.
 */
export function normaliseRegionPattern(
  raw: unknown,
  kind: SequencerKind,
  path: string,
  n: FieldNormaliser,
): RegionPattern | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    n.correction(`${path}: ${show(raw)} is not a pattern — dropped, the region plays the part's`);
    return undefined;
  }
  if (raw.kind !== kind) {
    n.correction(
      `${path}.kind: ${show(raw.kind)} is not the part's kind ${kind} — pattern dropped, the region plays the part's`,
    );
    return undefined;
  }
  // A stand-in seed for a seeded kind keeps `seed()` from reporting it missing.
  const written: Record<string, unknown> = { ...raw };
  delete written.seed;
  if (SEEDED_KINDS.includes(kind)) written.seed = 0;
  const spec: Record<string, unknown> = { ...normaliseSequencer(written, path, n) };
  delete spec.seed;
  return spec as RegionPattern;
}

function euclideanDriver(raw: unknown, path: string, n: FieldNormaliser): EuclideanDriver {
  const d = DEFAULT_EUCLIDEAN_CONFIG;
  const o = n.section(raw, path);
  const known = ['steps', 'divisor', 'pulses', 'rotate', 'density', 'pattern', 'seed'];
  n.dropUnknown(o, [...known, ...EUCLID_ROW_KEYS], path);
  const steps = n.int(o.steps, d.steps, 1, EUCLID_STEPS_MAX, `${path}.steps`);
  return {
    ...euclidRows(o, steps, path, n),
    steps,
    seed: seed(o.seed, `${path}.seed`, n),
    divisor: n.divisor(o.divisor, d.divisor, `${path}.divisor`),
    pulses: pulses(o.pulses, steps, `${path}.pulses`, n),
    rotate: n.int(o.rotate, 0, -steps, steps, `${path}.rotate`),
    density: density(o.density, `${path}.density`, n),
    // Always present, `null` when generative, so a live capture or release
    // merges through `AudioSystem.apply` (a merge only reaches keys the
    // current arrangement has).
    pattern: n.stepPattern(o.pattern, steps, `${path}.pattern`),
  };
}

/**
 * The ratchet row and the drawn lanes (windsor#355): each absent stays
 * absent, today's plain hit, so a song written before them round-trips
 * unchanged. `ratchets` is fitted to the steps (padded with 1, trimmed),
 * each a whole 1–`EUCLID_RATCHET_MAX`; the accent amounts are clamped to
 * 0–1; a lane is 1–`EUCLID_LANE_STEPS_MAX` steps of its own (`drawnLane`),
 * the pitch lane's semitones whole and within ±`EUCLID_PITCH_LANE_MAX`.
 * Each fix is reported.
 */
function euclidRows(
  o: Record<string, unknown>,
  steps: number,
  path: string,
  n: FieldNormaliser,
): EuclidRows {
  const rows: EuclidRows = {};
  const ratchetList = ratchets(o.ratchets, steps, `${path}.ratchets`, n);
  if (ratchetList) rows.ratchets = ratchetList;
  if (o.accentVelocity !== undefined) {
    const at = `${path}.accentVelocity`;
    rows.accentVelocity = n.num(o.accentVelocity, ACCENT_VELOCITY_DEFAULT, 0, 1, at);
  }
  if (o.accentMod !== undefined) {
    rows.accentMod = n.num(o.accentMod, ACCENT_MOD_DEFAULT, 0, 1, `${path}.accentMod`);
  }
  const accent = optionalLane(o.accentLane, `${path}.accentLane`, n, (v, at) =>
    n.bool(v, false, at),
  );
  if (accent) rows.accentLane = accent;
  const pitch = optionalLane(o.pitchLane, `${path}.pitchLane`, n, (v, at) =>
    n.int(v, 0, -EUCLID_PITCH_LANE_MAX, EUCLID_PITCH_LANE_MAX, at),
  );
  if (pitch) rows.pitchLane = pitch;
  const mod = cycledStepModLanes(o.modLanes, `${path}.modLanes`, n);
  if (mod) rows.modLanes = mod;
  return rows;
}

/** A drawn lane, or null when absent or dropped; each value through `value` at its path. */
function optionalLane<T>(
  raw: unknown,
  path: string,
  n: FieldNormaliser,
  value: (v: unknown, path: string) => T,
): T[] | null {
  if (raw === undefined) return null;
  return drawnLane(raw, path, n, (v, i) => value(v, `${path}[${i}]`));
}

/** One whole 1–`EUCLID_RATCHET_MAX` per step, or null when absent or not a list. */
function ratchets(raw: unknown, steps: number, path: string, n: FieldNormaliser): number[] | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of ratchets — every step a single hit`);
    return null;
  }
  if (raw.length !== steps)
    n.correction(`${path}: ${raw.length} ratchets for ${steps} steps — resized`);
  return Array.from({ length: steps }, (_, i) =>
    i < raw.length ? n.int(raw[i], 1, 1, EUCLID_RATCHET_MAX, `${path}[${i}]`) : 1,
  );
}

function pulses(
  raw: unknown,
  steps: number,
  path: string,
  n: FieldNormaliser,
): { min: number; max: number; start: number } {
  const d = DEFAULT_EUCLIDEAN_CONFIG.pulses;
  const o = n.section(raw, path);
  n.dropUnknown(o, ['min', 'max', 'start'], path);
  const min = n.int(o.min, Math.min(d.min, steps), 0, steps, `${path}.min`);
  let max = n.int(o.max, Math.min(d.max, steps), 0, steps, `${path}.max`);
  if (max < min) {
    n.correction(`${path}: max ${max} below min ${min} — raised to ${min}`);
    max = min;
  }
  const start = n.int(o.start, Math.min(Math.max(d.start, min), max), min, max, `${path}.start`);
  return { min, max, start };
}

function density(raw: unknown, path: string, n: FieldNormaliser): DensityMod {
  const o = n.section(raw, path);
  const kind = n.pick(o.kind, DENSITY_MOD_KINDS, 'lfoBars', `${path}.kind`);
  if (kind === 'walk') {
    n.dropUnknown(o, ['kind', 'stepChance'], path);
    return {
      kind,
      stepChance: n.num(o.stepChance, WALK_CHANCE, 0, 1, `${path}.stepChance`),
    };
  }
  if (kind === 'lfoHz') {
    n.dropUnknown(o, ['kind', 'hz', 'shape'], path);
    return {
      kind,
      hz: n.num(o.hz, LFO_HZ_DEFAULT, 0, LFO_HZ_MAX, `${path}.hz`),
      shape: n.pick(o.shape, LFO_SHAPES, 'tri', `${path}.shape`),
    };
  }
  n.dropUnknown(o, ['kind', 'bars', 'shape'], path);
  return {
    kind: 'lfoBars',
    bars: n.num(o.bars, LFO_BARS_DEFAULT, LFO_BARS_MIN, LFO_BARS_MAX, `${path}.bars`),
    shape: n.pick(o.shape, LFO_SHAPES, 'tri', `${path}.shape`),
  };
}

function gridDriver(raw: unknown, path: string, n: FieldNormaliser): GridDriver {
  const d = DEFAULT_GRID_CONFIG;
  const o = n.section(raw, path);
  const known = [
    'divisor',
    'steps',
    'length',
    'skipChance',
    'accentVelocity',
    'accentMod',
    'register',
    'seed',
    'lanes',
  ];
  n.dropUnknown(o, known, path);
  const steps = gridSteps(o.steps, `${path}.steps`, n);
  return {
    divisor: n.divisor(o.divisor, d.divisor, `${path}.divisor`),
    steps,
    // The whole line unless the document says shorter (#603); never past the steps written.
    length: n.int(o.length, steps.length, 1, steps.length, `${path}.length`),
    skipChance: n.num(o.skipChance, d.skipChance, 0, 1, `${path}.skipChance`),
    accentVelocity: n.num(o.accentVelocity, d.accentVelocity, 0, 1, `${path}.accentVelocity`),
    accentMod: n.num(o.accentMod, d.accentMod, 0, 1, `${path}.accentMod`),
    register: registerOctave(o.register, d.register.octave, `${path}.register`, n),
    seed: seed(o.seed, `${path}.seed`, n),
    lanes: stepModLanes(o.lanes, steps.length, `${path}.lanes`, n),
  };
}

/** 1–32 steps. An absent or junk list is the default bar; an over-long one is capped, reported. */
function gridSteps(raw: unknown, path: string, n: FieldNormaliser): GridStep[] {
  if (raw === undefined) return defaultGridSteps();
  if (!Array.isArray(raw) || raw.length === 0) {
    n.correction(`${path}: ${show(raw)} is not a list of steps — using the default bar`);
    return defaultGridSteps();
  }
  const capped: unknown[] = raw.length > GRID_STEPS_MAX ? raw.slice(0, GRID_STEPS_MAX) : raw;
  if (capped.length !== raw.length) {
    n.correction(`${path}: ${raw.length} steps capped to ${GRID_STEPS_MAX}`);
  }
  return capped.map((step, i) => gridStep(step, `${path}[${i}]`, n));
}

function gridStep(raw: unknown, path: string, n: FieldNormaliser): GridStep {
  const o = n.section(raw, path);
  const kind = n.pick(o.kind, GRID_STEP_KINDS, 'note', `${path}.kind`);
  if (kind !== 'note') return unpitchedStep(o, kind, path, n);
  n.dropUnknown(o, ['kind', 'degree', ...STEP_NOTE_KEYS], path);
  return gridNote(
    n.int(o.degree, 0, 0, GRID_DEGREE_MAX, `${path}.degree`),
    stepNoteFields(o, path, n),
  );
}
