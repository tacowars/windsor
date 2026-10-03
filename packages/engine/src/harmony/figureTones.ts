/**
 * The Figure's chord-tone rule (windsor#484, record
 * `2026-10-03-figure-sequencer`): a cell's `tone` is an index into the
 * chord's stack with octave carry, so 3 on a triad is the root an octave up
 * and -1 the top tone an octave down. No voicing enum: a Figure writes its
 * own voicing in its cells. Pure; the performer (windsor#485) and the
 * console's cell labels both read it.
 */
import { SEMITONES_PER_OCTAVE } from '../sequencing/scaleSampler';

/**
 * The note tone `tone` of `stack` (`HarmonyChord.stack`, semitones from the
 * key root) names over `rootNote`: `rootNote + stack[tone mod n] +
 * 12·⌊tone / n⌋`, a true modulo for a negative tone. Null for an empty stack.
 */
export function figureNote(
  stack: readonly number[],
  tone: number,
  rootNote: number,
): number | null {
  const n = stack.length;
  if (n === 0) return null;
  const index = ((tone % n) + n) % n;
  return rootNote + (stack[index] ?? 0) + SEMITONES_PER_OCTAVE * Math.floor(tone / n);
}
