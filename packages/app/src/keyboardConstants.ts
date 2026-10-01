/** The audition keyboard's tunables (#618): its range, its strike, its keys. */

/** The semitones within an octave that are black keys. */
export const BLACK_KEYS: ReadonlySet<number> = new Set([1, 3, 6, 8, 10]);
/** Two octaves of on-screen keys. */
export const KEY_COUNT = 24;
/** What the QWERTY row and the mouse strike with; MIDI brings its own. */
export const FIXED_VELOCITY = 0.9;
/** The octave the console opens at, and the `z` / `x` bounds. */
export const OCTAVE_DEFAULT = 4;
export const OCTAVE_MIN = 0;
export const OCTAVE_MAX = 8;
/** Semitone offset from the octave's C for each QWERTY note key. */
export const QWERTY: Readonly<Record<string, number>> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
};

/** The tab whose part the QWERTY keys play: on any other tab they sound nothing (windsor#349). */
export const AUDITION_TAB = 'parts';
