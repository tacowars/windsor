/**
 * The fields more than one sequencer kind shares, normalised once: the
 * part's own `seed` (#705, decision 16) and its absolute register octave
 * (decision 11), and the step grid's note shape and modulation lanes, which
 * the grid and, since windsor#127, the arp both carry, and the Euclid
 * part's drawn lanes of their own length (windsor#355).
 * `sequencerNormalise.ts` and `performerNormalise.ts` both read them, so
 * neither imports the other.
 */
import {
  EUCLID_LANE_STEPS_MAX,
  GRID_STEP_OCTAVE_MAX,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '../audioConstants';
import { isStepModParam, type StepModLane } from '../sequencing/stepModLanes';
import { STEP_MOD_LANES_MAX, type StepModParam } from '../worklet/fm/stepModTables';
import { show, type FieldNormaliser } from './arrangementFields';

/**
 * A sequencer's own `seed`: a safe integer. Unlike every other absent field
 * it is *reported* when missing — a seed the author never chose is still the
 * stream the song ships with — and defaults to 0.
 */
export function seed(raw: unknown, path: string, n: FieldNormaliser): number {
  if (raw === undefined) {
    n.correction(`${path}: missing — using 0`);
    return 0;
  }
  return n.int(raw, 0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, path);
}

/** A part's absolute register octave, `REGISTER_OCTAVE_MIN`..`REGISTER_OCTAVE_MAX`. */
export function registerOctave(
  raw: unknown,
  fallback: number,
  path: string,
  n: FieldNormaliser,
): { octave: number } {
  const reg = n.section(raw, path);
  n.dropUnknown(reg, ['octave'], path);
  return {
    octave: n.int(reg.octave, fallback, REGISTER_OCTAVE_MIN, REGISTER_OCTAVE_MAX, `${path}.octave`),
  };
}

/** A note step's octave (±`GRID_STEP_OCTAVE_MAX`), accent and slide: the shape a grid step and an arp cell share. */
export function stepNoteFields(
  o: Record<string, unknown>,
  path: string,
  n: FieldNormaliser,
): { octave: number; accent: boolean; slide: boolean } {
  return {
    octave: n.int(o.octave, 0, -GRID_STEP_OCTAVE_MAX, GRID_STEP_OCTAVE_MAX, `${path}.octave`),
    accent: n.bool(o.accent, false, `${path}.accent`),
    slide: n.bool(o.slide, false, `${path}.slide`),
  };
}

/**
 * Step modulation lanes (windsor#17): absent is none, today's behaviour. A
 * lane naming an unknown or repeated parameter is dropped, lanes past
 * `STEP_MOD_LANES_MAX` are dropped, each value is clamped to -1..1, and a
 * lane is padded with 0 or trimmed to the step count, each reported.
 */
export function stepModLanes(
  raw: unknown,
  steps: number,
  path: string,
  n: FieldNormaliser,
): StepModLane[] {
  return modLanes(raw, path, n, (values, at) => laneValues(values, steps, at, n)) ?? [];
}

/**
 * A Euclid part's step modulation lanes (windsor#355), each its own length:
 * absent stays absent. Parameters are checked as `stepModLanes` checks
 * them; a lane whose values are empty or not a list is dropped, a longer
 * one than `EUCLID_LANE_STEPS_MAX` trimmed, and each value clamped to
 * -1..1, each reported.
 */
export function cycledStepModLanes(
  raw: unknown,
  path: string,
  n: FieldNormaliser,
): StepModLane[] | undefined {
  return modLanes(raw, path, n, (values, at) =>
    drawnLane(values, at, n, (v, i) => n.num(v, 0, -1, 1, `${at}[${i}]`)),
  );
}

/**
 * A drawn lane of 1–`EUCLID_LANE_STEPS_MAX` steps (windsor#355), each value
 * through `value`: null, reported, for one that is empty or not a list, and
 * a longer one trimmed, reported. A lane's length is its own.
 */
export function drawnLane<T>(
  raw: unknown,
  path: string,
  n: FieldNormaliser,
  value: (v: unknown, i: number) => T,
): T[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    n.correction(
      `${path}: ${show(raw)} is not a lane of 1–${EUCLID_LANE_STEPS_MAX} steps — dropped`,
    );
    return null;
  }
  if (raw.length > EUCLID_LANE_STEPS_MAX) {
    n.correction(`${path}: ${raw.length} steps trimmed to ${EUCLID_LANE_STEPS_MAX}`);
  }
  return raw.slice(0, EUCLID_LANE_STEPS_MAX).map(value);
}

/**
 * The lanes of `raw`, each through `values` (null drops the lane), with an
 * unknown or repeated parameter and lanes past `STEP_MOD_LANES_MAX` dropped,
 * each reported; undefined for absent, and for junk in place of a list.
 */
function modLanes(
  raw: unknown,
  path: string,
  n: FieldNormaliser,
  values: (raw: unknown, path: string) => number[] | null,
): StepModLane[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of lanes — no lanes`);
    return undefined;
  }
  const lanes: StepModLane[] = [];
  const seen = new Set<StepModParam>();
  raw.forEach((item, i) => {
    const at = `${path}[${i}]`;
    const o = n.section(item, at);
    n.dropUnknown(o, ['param', 'values'], at);
    const drop = (why: string): void => n.correction(`${at}: ${why} — lane dropped`);
    const param = o.param;
    if (!isStepModParam(param))
      return drop(`${show(param)} is not a parameter a lane can modulate`);
    if (seen.has(param)) return drop(`${param} already has a lane`);
    if (lanes.length >= STEP_MOD_LANES_MAX) return drop(`more than ${STEP_MOD_LANES_MAX} lanes`);
    const kept = values(o.values, `${at}.values`);
    if (kept === null) return;
    seen.add(param);
    lanes.push({ param, values: kept });
  });
  return lanes;
}

/** One value per step in -1..1: junk is 0, a short list padded with 0, a long one trimmed. */
function laneValues(raw: unknown, steps: number, path: string, n: FieldNormaliser): number[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw)) n.correction(`${path}: ${show(raw)} is not a list of values — all 0`);
  else if (raw.length !== steps) {
    n.correction(`${path}: ${raw.length} values for ${steps} steps — resized`);
  }
  return Array.from({ length: steps }, (_, i) =>
    i < list.length ? n.num(list[i], 0, -1, 1, `${path}[${i}]`) : 0,
  );
}
