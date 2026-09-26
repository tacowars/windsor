/**
 * The two fields every generative or pitched sequencer kind shares (#705),
 * normalised once: the part's own `seed` (decision 16) and its absolute
 * register octave (decision 11). `sequencerNormalise.ts` and
 * `performerNormalise.ts` both read them, so neither imports the other.
 */
import { REGISTER_OCTAVE_MAX, REGISTER_OCTAVE_MIN } from '../audioConstants';
import type { FieldNormaliser } from './arrangementFields';

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
