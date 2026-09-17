/**
 * What a new song starts as in the console (#598): the defaults `newSong()`
 * builds from. Tunables, not logic — a different starting tempo or key is an
 * edit here.
 */

/** The new song's tempo, in BPM. */
export const NEW_SONG_BPM = 120;

/**
 * The new song's key: a real scale, so the first arpeggiator a part is given
 * has somewhere to go. (The normaliser's own default is the root alone, which
 * is right for a damaged document and wrong for a blank page.)
 */
export const NEW_SONG_KEY = { root: 48, scale: 'naturalMinor' } as const;

/** A part's default label: `Part 1` for slot 0. */
export const partLabelFor = (slot: number): string => `Part ${slot + 1}`;
