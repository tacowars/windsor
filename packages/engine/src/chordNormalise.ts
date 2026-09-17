/**
 * A chord part's sequencer, normalised (#606): the `chord` branch of
 * `normaliseSequencer` (`sequencerNormalise.ts`), in its own file because
 * the steps carry more fields than any other kind. Everything returned
 * satisfies `assertChordConfig` by construction — a divisor from the table,
 * a gate in (0, 1], a known voicing, 0–32 steps each with a table duration,
 * a repeat 1–8 and, for a chord, a size of 3 or 4 and bounded inversion,
 * octave and semitone — so building the generator cannot throw. An absent
 * `steps` is empty: a chord part opens blank (epic #605 decision 10).
 */
import type { ChordDriver } from './arrangement';
import { show, type FieldNormaliser } from './arrangementFields';
import {
  CHORD_INVERSION_MAX,
  CHORD_REPEAT_MAX,
  CHORD_SEMITONE_MAX,
  CHORD_SIZE_TRIAD,
  CHORD_STEPS_MAX,
  CHORD_STEP_OCTAVE_MAX,
  GATE_MIN,
  GRID_DEGREE_MAX,
  OCTAVE_MAX,
} from './audioConstants';
import {
  CHORD_DIVISORS,
  CHORD_DURATIONS,
  CHORD_VOICING_IDS,
  CHORD_VOICING_DEFAULT,
} from './chordTables';
import {
  CHORD_STEP_KINDS,
  DEFAULT_CHORD_CONFIG,
  chordStep,
  restStep,
  type ChordStep,
} from './chordSequencer';
import { isChordSize, type ChordSize } from './chordTheory';

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
        -OCTAVE_MAX,
        OCTAVE_MAX,
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
  n.dropUnknown(
    o,
    ['kind', 'degree', 'size', 'inversion', 'octave', 'semitone', 'duration', 'repeat'],
    path,
  );
  return chordStep(n.int(o.degree, 0, 0, GRID_DEGREE_MAX, `${path}.degree`), {
    ...timing,
    size: size(o.size, `${path}.size`, n),
    inversion: n.int(o.inversion, 0, 0, CHORD_INVERSION_MAX, `${path}.inversion`),
    octave: n.int(o.octave, 0, -CHORD_STEP_OCTAVE_MAX, CHORD_STEP_OCTAVE_MAX, `${path}.octave`),
    semitone: n.int(o.semitone, 0, -CHORD_SEMITONE_MAX, CHORD_SEMITONE_MAX, `${path}.semitone`),
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

/** A triad or a seventh; anything else is a triad, reported. */
function size(raw: unknown, path: string, n: FieldNormaliser): ChordSize {
  if (raw === undefined) return CHORD_SIZE_TRIAD;
  if (typeof raw === 'number' && isChordSize(raw)) return raw;
  n.correction(`${path}: ${show(raw)} is not a triad (3) or a seventh (4) — using a triad`);
  return CHORD_SIZE_TRIAD;
}
