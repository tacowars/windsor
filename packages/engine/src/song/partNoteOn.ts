/**
 * A pitched generator's note-on as its part plays it (#602, windsor#17): a
 * grid accent bumps the part's velocity and rides in as per-note mod, a
 * slide flags the legato hand-over, and a step's parameter offsets ride
 * along when the step has any. A plain note carries no extras, so its call
 * is exactly what it was before either. A Euclid hit (windsor#355) takes the
 * same rule from its lanes, its note moved by the pitch lane. Pure;
 * `partNoteOn.test.ts`.
 */
import { MIDI_NOTE_MAX } from '../audioConstants';
import type { EuclidHitRead } from '../sequencing/euclidLanes';
import type { NoteOnEvent } from '../sequencing/noteEvent';
import type { NoteExtras } from '../synth/audioPart';

/** The velocity and extras a part's `noteOn` takes for one event. */
export interface PartNoteOn {
  readonly velocity: number;
  readonly extras: NoteExtras | undefined;
}

/** What a note-on carries beyond its pitch: a `NoteOnEvent` is one, a Euclid hit's read another. */
export type NoteOnMarks = {
  readonly [K in 'accent' | 'slide' | 'stepMod']?: NoteOnEvent[K] | undefined;
};

/** `event` as its part plays it, over the part's own `velocity`. */
export function partNoteOn(event: NoteOnMarks, velocity: number): PartNoteOn {
  const { accent, slide, stepMod } = event;
  const played = accent ? Math.min(1, velocity + accent.velocity) : velocity;
  if (!accent && !slide && !stepMod) return { velocity: played, extras: undefined };
  const extras: NoteExtras = { mod: accent?.mod ?? 0, slide: slide === true };
  if (stepMod) extras.stepMod = stepMod;
  return { velocity: played, extras };
}

/** A Euclid hit as its part plays it: the part's `note` plus the pitch lane, clamped to MIDI. */
export interface EuclidNoteOn extends PartNoteOn {
  readonly note: number;
}

/**
 * A Euclid hit over the part's `note` and `velocity` (windsor#355): the
 * pitch lane's semitones added and the sum clamped to 0..`MIDI_NOTE_MAX`,
 * and the lanes' accent and offsets by the grid's rule. A hit with neither
 * sends no extras, as a plain Euclid hit always has.
 */
export function euclidNoteOn(read: EuclidHitRead, note: number, velocity: number): EuclidNoteOn {
  const pitched = Math.min(MIDI_NOTE_MAX, Math.max(0, note + read.semitones));
  return { note: pitched, ...partNoteOn(read, velocity) };
}
