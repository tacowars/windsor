/**
 * bloom's Key and Scale as the processor's pitch set (windsor#728, record
 * `2026-10-11-bloom-follows-the-song`). Bloom keeps no list of its own: Key
 * picks from Windsor's note names (`CHORD_NOTE_NAMES`, the transport's Key),
 * and Scale from `chromatic`, Bloom's off, then Windsor's `SCALE_NAMES`, so a
 * scale added to `SCALES` reaches Bloom with no Bloom or worklet edit.
 *
 * `pitchMask` folds a scale's offsets above a root into the 12-bit set the
 * processor takes (`BLOOM_PITCHES_ALL` is every pitch class); the processor
 * works out each pitch class's correction from it. Scale's `song` (windsor#717)
 * takes the song's root and scale instead of Key's, whichever scale the song
 * is in, a custom one included. Main thread only: the worklet imports none of
 * this. Pinned by `bloomPitches.test.ts`.
 */
import { CHORD_NOTE_NAMES } from '../harmony/chordTables';
import type { Harmony } from '../harmony/harmonyTimeline';
import { SCALE_NAMES, scaleOffsets } from '../sequencing/scaleSampler';
import type { ScaleName } from '../sequencing/scaleSampler';
import {
  BLOOM_PITCH_CLASSES,
  BLOOM_PITCHES_ALL,
  BLOOM_SCALE_DEFAULT,
  BLOOM_SCALE_SONG,
} from './bloomConstants';

/**
 * Scale's choices: `chromatic` (every pitch class, Bloom's off), `song` (the
 * song's key), then Windsor's scales in order.
 */
export type BloomScale = typeof BLOOM_SCALE_DEFAULT | typeof BLOOM_SCALE_SONG | ScaleName;
export const BLOOM_SCALE_CHOICES: readonly BloomScale[] = [
  BLOOM_SCALE_DEFAULT,
  BLOOM_SCALE_SONG,
  ...SCALE_NAMES,
];

/** Key's choices: Windsor's twelve note names, sharps, C first (the list itself, not a copy). */
export type BloomKey = (typeof CHORD_NOTE_NAMES)[number];
export const BLOOM_KEY_CHOICES: readonly BloomKey[] = CHORD_NOTE_NAMES;

/** The song's key as the stage holds it: the harmony's root and scale, a custom scale included. */
export type SongKey = Pick<Harmony, 'root' | 'scale'>;

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

/**
 * The processor's pitch set for a Key and Scale: `chromatic` is every pitch
 * class, and `song` is `songKey`'s set, Key aside; with no song key yet (no
 * song loaded), `song` plays every pitch class.
 */
export function bloomPitches(
  spec: { readonly key: BloomKey; readonly scale: BloomScale },
  songKey?: SongKey,
): number {
  if (spec.scale === BLOOM_SCALE_DEFAULT) return BLOOM_PITCHES_ALL;
  if (spec.scale === BLOOM_SCALE_SONG) {
    return songKey ? pitchMask(songKey.root, scaleOffsets(songKey.scale)) : BLOOM_PITCHES_ALL;
  }
  return pitchMask(Math.max(0, BLOOM_KEY_CHOICES.indexOf(spec.key)), scaleOffsets(spec.scale));
}
