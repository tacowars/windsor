/**
 * How the Roll draws a note, a stem and a key (windsor#602 decisions 4 and
 * 6), without the DOM: the fill strength from velocity, the stem's height,
 * whether a note is named, a key label's size, and the colour each drawn
 * note takes from the chord at its own onset.
 */
import type { Harmony, RollNote } from '@windsor/engine';
import { type NoteTier, noteTier, tonesAt } from './rollHarmony';
import type { RollInstance } from './rollRepeats';
import type { RollRow } from './rollRows';
import { ROLL_KEY_FONT, ROLL_NOTE, ROLL_STEM } from './rollTables';

/** A note's velocity: absent is 1. */
export const velocityOf = (note: RollNote): number => note.velocity ?? 1;

/** The fill strength, in percent: `45 % + 55 % × velocity`. */
export const fillPct = (velocity: number, look = ROLL_NOTE): number =>
  Math.round(look.fillFloorPct + look.fillSpanPct * velocity);

/** A stem's height in a lane `lanePx` high. */
export const stemPx = (velocity: number, lanePx: number, stem = ROLL_STEM): number =>
  Math.max(stem.minPx, velocity * (lanePx - stem.insetPx));

/** Whether a note drawn `w` × `h` px is wide and tall enough to carry its name. */
export const noteNamed = (w: number, h: number, look = ROLL_NOTE): boolean =>
  h >= look.labelMinHPx && w >= look.labelMinWPx;

/** A key label's font size on a row `h` px tall. */
export const keyFontPx = (h: number, font = ROLL_KEY_FONT): number =>
  Math.min(font.max, Math.max(font.min, h - font.inset));

/** A drawn note's colour: its tier, grey on a thin sliver, hollow when parked past the loop. */
export type NoteLook = NoteTier | 'grey' | 'parked';

/** Where the song is: the harmony, its length, and the region's first tick. */
export interface SongPlace {
  readonly harmony: Harmony;
  readonly songTicks: number;
  readonly regionStart: number;
}

/** The colour of `instance` of `note` on `row`: the chord at the instance's own onset. */
export function instanceLook(
  note: RollNote,
  instance: RollInstance,
  row: RollRow,
  place: SongPlace,
): NoteLook {
  if (instance.parked) return 'parked';
  if (row.thin) return 'grey';
  const { tones } = tonesAt(place.harmony, place.songTicks, place.regionStart + instance.start);
  return noteTier(note.pitch, tones);
}

/** A stem's colour: the note's tier at its onset (a thin row's note keeps its tier here). */
export function stemLook(note: RollNote, instance: RollInstance, place: SongPlace): NoteTier {
  const { tones } = tonesAt(place.harmony, place.songTicks, place.regionStart + instance.start);
  return noteTier(note.pitch, tones);
}
