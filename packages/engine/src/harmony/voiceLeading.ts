/**
 * Minimal voice motion for a held Chord Player hit that follows the harmony
 * (windsor#333, record `2026-10-02-chord-player-follow`): when the chord
 * changes under a sounding hit, the tones the new chord shares stay held and
 * only the voices that must move step to the nearest new chord tone.
 *
 * Pure and independent of the part's voicing and the step's inversion: the
 * held notes and the new chord's stack in, the moved notes out. The voice
 * count never changes — a chord with more tones than voices leaves tones
 * unsounded, one with fewer lets two voices share a pitch class on different
 * octaves.
 */
import { SEMITONES_PER_OCTAVE } from '../sequencing/scaleSampler';

/** How far a voice may step to reach a free chord tone, either way, in semitones. */
export const FOLLOW_REACH_SEMITONES = 6;

const pitchClass = (note: number): number =>
  ((note % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;

/** The nearest free target within the reach, down first on a tie; the note itself when none is free. */
function nearestFree(
  note: number,
  targets: ReadonlySet<number>,
  taken: ReadonlySet<number>,
): number {
  const free = (candidate: number): boolean =>
    targets.has(pitchClass(candidate)) && !taken.has(candidate);
  for (let distance = 1; distance <= FOLLOW_REACH_SEMITONES; distance++) {
    if (free(note - distance)) return note - distance;
    if (free(note + distance)) return note + distance;
  }
  return note;
}

/**
 * Re-voice `held` onto the chord `stack` (semitones above the key root, as
 * `HarmonyChord.stack` carries it) in the key whose root is `keyRootNote`
 * (any MIDI note of the root; only its pitch class counts).
 *
 * Every held note whose pitch class is a chord tone stays. The others, lowest
 * first, each move to the nearest MIDI note within ±`FOLLOW_REACH_SEMITONES`
 * whose pitch class is a chord tone and that no voice has taken yet; on a tie
 * between up and down, down wins; with every target in reach taken, the voice
 * keeps its note. The result is in the held notes' order, so a caller can
 * tell which voice moved where.
 */
export function followVoices(
  held: readonly number[],
  stack: readonly number[],
  keyRootNote: number,
): number[] {
  const targets = new Set(stack.map((tone) => pitchClass(tone + keyRootNote)));
  const moved = [...held];
  const taken = new Set(held.filter((note) => targets.has(pitchClass(note))));
  const movers = held
    .map((note, index) => ({ note, index }))
    .filter(({ note }) => !targets.has(pitchClass(note)))
    .sort((a, b) => a.note - b.note || a.index - b.index);
  for (const { note, index } of movers) {
    const next = nearestFree(note, targets, taken);
    moved[index] = next;
    taken.add(next);
  }
  return moved;
}
