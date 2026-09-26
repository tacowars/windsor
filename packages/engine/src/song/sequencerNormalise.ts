/**
 * A part's sequencer, normalised (#597): the tagged union behind
 * `DocumentPart.sequencer` and the driver fields of each kind. Everything
 * returned satisfies the generator constructors' asserted ranges by
 * construction — integers where integers are required, divisors that divide
 * the 96-tick bar, gates in (0, 1] — so building a generator from it cannot
 * throw. `ArrangementNormaliser` (`arrangementNormalise.ts`) calls it per part.
 */
import { chordDriver } from '../harmony/chordNormalise';
import type { EuclideanDriver, GridDriver, SequencerSpec } from './arrangement';
import { SEQUENCER_KINDS } from './arrangement';
import { show, type FieldNormaliser } from './arrangementFields';
import {
  EUCLID_STEPS_MAX,
  GRID_DEGREE_MAX,
  GRID_STEPS_MAX,
  GRID_STEP_OCTAVE_MAX,
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
  OCTAVE_MAX,
  WALK_CHANCE,
} from '../audioConstants';
import {
  DEFAULT_EUCLIDEAN_CONFIG,
  DENSITY_MOD_KINDS,
  LFO_SHAPES,
  type DensityMod,
} from '../sequencing/euclideanSequencer';
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
    default:
      n.dropUnknown(driver, [], path);
      return { kind: 'none' };
  }
}

function euclideanDriver(raw: unknown, path: string, n: FieldNormaliser): EuclideanDriver {
  const d = DEFAULT_EUCLIDEAN_CONFIG;
  const o = n.section(raw, path);
  n.dropUnknown(o, ['steps', 'divisor', 'pulses', 'rotate', 'density', 'pattern'], path);
  const steps = n.int(o.steps, d.steps, 1, EUCLID_STEPS_MAX, `${path}.steps`);
  return {
    steps,
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
  ];
  n.dropUnknown(o, known, path);
  const reg = n.section(o.register, `${path}.register`);
  n.dropUnknown(reg, ['octave'], `${path}.register`);
  const steps = gridSteps(o.steps, `${path}.steps`, n);
  return {
    divisor: n.divisor(o.divisor, d.divisor, `${path}.divisor`),
    steps,
    // The whole line unless the document says shorter (#603); never past the steps written.
    length: n.int(o.length, steps.length, 1, steps.length, `${path}.length`),
    skipChance: n.num(o.skipChance, d.skipChance, 0, 1, `${path}.skipChance`),
    accentVelocity: n.num(o.accentVelocity, d.accentVelocity, 0, 1, `${path}.accentVelocity`),
    accentMod: n.num(o.accentMod, d.accentMod, 0, 1, `${path}.accentMod`),
    register: {
      octave: n.int(
        reg.octave,
        d.register.octave,
        -OCTAVE_MAX,
        OCTAVE_MAX,
        `${path}.register.octave`,
      ),
    },
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
  if (kind !== 'note') {
    n.dropUnknown(o, ['kind'], path);
    return { kind };
  }
  n.dropUnknown(o, ['kind', 'degree', 'octave', 'accent', 'slide'], path);
  return gridNote(n.int(o.degree, 0, 0, GRID_DEGREE_MAX, `${path}.degree`), {
    octave: n.int(o.octave, 0, -GRID_STEP_OCTAVE_MAX, GRID_STEP_OCTAVE_MAX, `${path}.octave`),
    accent: n.bool(o.accent, false, `${path}.accent`),
    slide: n.bool(o.slide, false, `${path}.slide`),
  });
}
