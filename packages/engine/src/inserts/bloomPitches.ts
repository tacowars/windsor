/**
 * bloom's Key and Scale as the processor's pitch set (windsor#728, record
 * `2026-10-11-bloom-follows-the-song`). Bloom keeps no list of its own: Key
 * picks from Windsor's note names (`CHORD_NOTE_NAMES`, the transport's Key),
 * and Scale from `chromatic`, Bloom's off, then Windsor's `SCALE_NAMES`, so a
 * scale added to `SCALES` reaches Bloom with no Bloom or worklet edit.
 *
 * `pitchMask` folds a scale's offsets above a root into the 12-bit set the
 * processor takes (`BLOOM_PITCHES_ALL` is every pitch class); the processor
 * works out each pitch class's correction from it. Main thread only: the
 * worklet imports none of this. Pinned by `bloomPitches.test.ts`.
 */
import { CHORD_NOTE_NAMES } from '../harmony/chordTables';
import { SCALE_NAMES, scaleOffsets } from '../sequencing/scaleSampler';
import type { ScaleName } from '../sequencing/scaleSampler';
import { BLOOM_PITCH_CLASSES, BLOOM_PITCHES_ALL, BLOOM_SCALE_DEFAULT } from './bloomConstants';

/** Scale's choices: `chromatic` (every pitch class, Bloom's off), then Windsor's scales in order. */
export type BloomScale = typeof BLOOM_SCALE_DEFAULT | ScaleName;
export const BLOOM_SCALE_CHOICES: readonly BloomScale[] = [BLOOM_SCALE_DEFAULT, ...SCALE_NAMES];

/** Key's choices: Windsor's twelve note names, sharps, C first (the list itself, not a copy). */
export type BloomKey = string;
export const BLOOM_KEY_CHOICES: readonly BloomKey[] = CHORD_NOTE_NAMES;

/**
 * The 12-bit set of the pitch classes `offsets` reach above `root` (a pitch
 * class, C = 0), each folded mod 12: bit p set when pitch class p is in it.
 * No offsets is the empty set, 0.
 */
export function pitchMask(root: number, offsets: readonly number[]): number {
  let mask = 0;
  for (const offset of offsets) {
    const pc =
      (((root + offset) % BLOOM_PITCH_CLASSES) + BLOOM_PITCH_CLASSES) % BLOOM_PITCH_CLASSES;
    mask |= 1 << pc;
  }
  return mask;
}

/** The processor's pitch set for a Key and Scale: `chromatic` is every pitch class. */
export function bloomPitches(spec: { readonly key: BloomKey; readonly scale: BloomScale }): number {
  if (spec.scale === BLOOM_SCALE_DEFAULT) return BLOOM_PITCHES_ALL;
  return pitchMask(Math.max(0, BLOOM_KEY_CHOICES.indexOf(spec.key)), scaleOffsets(spec.scale));
}
