/**
 * A Chord Player part's sequencer, normalised (#606, #705): the `chord`
 * branch of `normaliseSequencer` (`sequencerNormalise.ts`), in its own file
 * because the steps carry more fields than any other kind. Everything
 * returned satisfies `assertChordConfig` by construction — a divisor from
 * the table, a gate in (0, 1], a known voicing, an absolute register octave,
 * 0–32 steps each with a table duration, a repeat 1–8 and, for a hit, a
 * bounded inversion and octave — so building the generator cannot throw. A
 * step carries no pitch (epic #703 decision 15): the chord is the harmony
 * timeline's. An absent `steps` is empty: a chord part opens blank.
 */
import type { ChordDriver } from '../song/arrangement';
import { show, type FieldNormaliser } from '../song/arrangementFields';
import {
  CHORD_INVERSION_MAX,
  CHORD_REPEAT_MAX,
  CHORD_STEPS_MAX,
  CHORD_STEP_OCTAVE_MAX,
  GATE_MIN,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '../audioConstants';
import {
  CHORD_DIVISORS,
  CHORD_DURATIONS,
  CHORD_VOICING_IDS,
  CHORD_VOICING_DEFAULT,
} from './chordTables';
import {
  CHORD_STEP_KINDS,
  DEFAULT_CHORD_CONFIG,
  hitStep,
  restStep,
  type ChordStep,
} from '../sequencing/chordSequencer';

export function chordDriver(raw: unknown, path: string, n: FieldNormaliser): ChordDriver {
  const d = DEFAULT_CHORD_CONFIG;
  const o = n.section(raw, path);
  n.dropUnknown(o, ['divisor', 'gate', 'voicing', 'register', 'steps'], path);
  const reg = n.section(o.register, `${path}.register`);
  n.dropUnknown(reg, ['octave'], `${path}.register`);
  return {
    divisor: divisor(o.divisor, `${path}.divisor`, n),
    gate: n.num(o.gate, d.gate, GATE_MIN, 1, `${path}.gate`),
    voicing: n.pick(o.voicing, CHORD_VOICING_IDS, CHORD_VOICING_DEFAULT, `${path}.voicing`),
    register: {
      octave: n.int(
        reg.octave,
        d.register.octave,
        REGISTER_OCTAVE_MIN,
        REGISTER_OCTAVE_MAX,
        `${path}.register.octave`,
      ),
    },
    steps: steps(o.steps, `${path}.steps`, n),
  };
}

/** One of `CHORD_DIVISORS`; anything else takes the default base step, reported. */
function divisor(raw: unknown, path: string, n: FieldNormaliser): number {
  const fallback = DEFAULT_CHORD_CONFIG.divisor;
  if (raw === undefined) return fallback;
  if (typeof raw === 'number' && CHORD_DIVISORS.includes(raw)) return raw;
  n.correction(
    `${path}: ${show(raw)} is not one of ${CHORD_DIVISORS.join('|')} — using ${fallback}`,
  );
  return fallback;
}

/** 0–32 steps. Absent is empty; junk is empty, reported; an over-long list is capped, reported. */
function steps(raw: unknown, path: string, n: FieldNormaliser): ChordStep[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of steps — using none`);
    return [];
  }
  const capped: unknown[] = raw.length > CHORD_STEPS_MAX ? raw.slice(0, CHORD_STEPS_MAX) : raw;
  if (capped.length !== raw.length) {
    n.correction(`${path}: ${raw.length} steps capped to ${CHORD_STEPS_MAX}`);
  }
  return capped.map((step, i) => chordStepOf(step, `${path}[${i}]`, n));
}

function chordStepOf(raw: unknown, path: string, n: FieldNormaliser): ChordStep {
  const o = n.section(raw, path);
  const kind = n.pick(o.kind, CHORD_STEP_KINDS, 'rest', `${path}.kind`);
  const timing = {
    duration: duration(o.duration, `${path}.duration`, n),
    repeat: n.int(o.repeat, restStep().repeat, 1, CHORD_REPEAT_MAX, `${path}.repeat`),
  };
  if (kind === 'rest') {
    n.dropUnknown(o, ['kind', 'duration', 'repeat'], path);
    return restStep(timing);
  }
  n.dropUnknown(o, ['kind', 'inversion', 'octave', 'duration', 'repeat'], path);
  return hitStep({
    ...timing,
    inversion: n.int(o.inversion, 0, 0, CHORD_INVERSION_MAX, `${path}.inversion`),
    octave: n.int(o.octave, 0, -CHORD_STEP_OCTAVE_MAX, CHORD_STEP_OCTAVE_MAX, `${path}.octave`),
  });
}

/** One of `CHORD_DURATIONS`; anything else is one base step, reported. */
function duration(raw: unknown, path: string, n: FieldNormaliser): number {
  const fallback = restStep().duration;
  if (raw === undefined) return fallback;
  if (typeof raw === 'number' && CHORD_DURATIONS.includes(raw)) return raw;
  n.correction(
    `${path}: ${show(raw)} is not one of ${CHORD_DURATIONS.join('|')} — using ${fallback}`,
  );
  return fallback;
}
