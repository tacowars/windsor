/**
 * The fields more than one sequencer kind shares, normalised once: the
 * part's own `seed` (#705, decision 16) and its absolute register octave
 * (decision 11), and the step grid's note shape and modulation lanes, which
 * the grid and, since windsor#127, the arp both carry.
 * `sequencerNormalise.ts` and `performerNormalise.ts` both read them, so
 * neither imports the other.
 */
import { GRID_STEP_OCTAVE_MAX, REGISTER_OCTAVE_MAX, REGISTER_OCTAVE_MIN } from '../audioConstants';
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
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of lanes — no lanes`);
    return [];
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
    seen.add(param);
    lanes.push({ param, values: laneValues(o.values, steps, `${at}.values`, n) });
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
