/**
 * What a new song starts as in the console (#598): the defaults `newSong()`
 * builds from. Tunables, not logic — a different starting tempo or key is an
 * edit here.
 */

/** The new song's tempo, in BPM. */
export const NEW_SONG_BPM = 120;

/** The new song's length in bars (#705): four, the placeholder song's. */
export const NEW_SONG_BARS = 4;

/**
 * The new song's harmony: a real scale on C, so the first grid or chord part
 * has degrees to read. (The normaliser's own default is the root alone, which
 * is right for a damaged document and wrong for a blank page.) The events are
 * left to the normaliser: the tonic for the whole song.
 */
export const NEW_SONG_HARMONY = { root: 0, scale: 'naturalMinor' } as const;

/** A part's default label: `Part 1` for slot 0. */
export const partLabelFor = (slot: number): string => `Part ${slot + 1}`;

/**
 * How many user-visible characters (graphemes) of a patch's name a generic
 * part takes when it is first given that patch (windsor#103).
 */
export const PART_AUTO_NAME_LENGTH = 6;
