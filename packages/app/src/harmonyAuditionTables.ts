/**
 * The harmony card's audition voice (windsor#332 decision 7): one fixed
 * built-in patch on the engine's `audition` aux strip, and where its chord
 * sits. Muted Chamber is the pick: a soft muted-strings bed whose amplitude
 * attack is about a quarter second and whose release is under a second, so
 * a chord speaks at once and stops cleanly when the ▶ is let go. Its file
 * says "Play C3–C5", the register the voicing below lands in.
 */

/** The built-in library id the audition part plays. */
export const HARMONY_AUDITION_PATCH = 'score-muted-chamber';

/** Every audition note's velocity: under full, so a five-note chord stays soft. */
export const HARMONY_AUDITION_VELOCITY = 0.8;

/** The MIDI note of C4: the key root is voiced in octave 4, above this (decision 5). */
export const HARMONY_AUDITION_KEY_OCTAVE_NOTE = 60;

/** How far below the close chord its root is doubled, in octaves. */
export const HARMONY_AUDITION_BASS_OCTAVES = 1;
