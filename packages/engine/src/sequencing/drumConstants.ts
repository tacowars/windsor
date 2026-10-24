/**
 * The Drum's tunables (windsor#948, record `2026-10-24-drum-sequencer`):
 * the gate a new Drum part plays at, how far a hit's pitch may move off the
 * part's base note, and the hits a new part starts with. The logic is
 * `drumSteps.ts` and `drumSequencer.ts`, which take these as parameters
 * defaulting to them.
 */

/** The fraction of a step's swung span a hit is held on a new Drum part. */
export const DRUM_GATE_DEFAULT = 0.5;

/** A hit's `pitch` is whole semitones within ±this of the part's `note`: two octaves. */
export const DRUM_PITCH_MAX = 24;

/**
 * The local steps a new Drum part hits, at velocity 1: four on the floor in
 * a bar of sixteenths, so a new part sounds. A bar shorter than the last of
 * them keeps those inside it.
 */
export const DRUM_DEFAULT_HITS: readonly number[] = [0, 4, 8, 12];
