/**
 * A pitched generator's note-on as its part plays it (#602, windsor#17): a
 * grid accent bumps the part's velocity and rides in as per-note mod, a
 * slide flags the legato hand-over, and a step's parameter offsets ride
 * along when the step has any. A plain note carries no extras, so its call
 * is exactly what it was before either. Pure; `partNoteOn.test.ts`.
 */
import type { NoteOnEvent } from '../sequencing/noteEvent';
import type { NoteExtras } from '../synth/audioPart';

/** The velocity and extras a part's `noteOn` takes for one event. */
export interface PartNoteOn {
  readonly velocity: number;
  readonly extras: NoteExtras | undefined;
}

/** `event` as its part plays it, over the part's own `velocity`. */
export function partNoteOn(event: NoteOnEvent, velocity: number): PartNoteOn {
  const { accent, slide, stepMod } = event;
  const played = accent ? Math.min(1, velocity + accent.velocity) : velocity;
  if (!accent && !slide && !stepMod) return { velocity: played, extras: undefined };
  const extras: NoteExtras = { mod: accent?.mod ?? 0, slide: slide === true };
  if (stepMod) extras.stepMod = stepMod;
  return { velocity: played, extras };
}
