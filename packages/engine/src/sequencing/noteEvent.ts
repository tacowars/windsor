/**
 * What a pitched generator emits: explicit note-on and note-off events on the
 * tick grid. A binding (#69b) maps them onto a part; the generator never sees
 * the part (record `2026-08-31-generative-sequencing-transport-and-pitch` §2).
 *
 * Note-off is its own event rather than a duration on the note-on so a tie can
 * be expressed exactly: a held note whose next step repeats it emits nothing,
 * and the off arrives only when the pitch changes or the sequence is released.
 */

export interface NoteOnEvent {
  kind: 'noteOn';
  tick: number;
  /** Clock time the note should sound at (see `TickEvent.time`). */
  time: number;
  /** MIDI note number. */
  note: number;
  /** Scale degree the note was drawn from, for bindings that want it. */
  degree: number;
  /**
   * A grid accent (#602): the bump to add to the part's velocity, and the
   * per-note mod value the voice adds to the wheel. Absent on a plain note.
   */
  accent?: { velocity: number; mod: number };
  /**
   * A grid slide (#602): the note takes over the held voice legato instead of
   * starting a new one. Emitted before the held note's off at the same tick.
   */
  slide?: boolean;
}

export interface NoteOffEvent {
  kind: 'noteOff';
  tick: number;
  time: number;
  note: number;
}

export type NoteEvent = NoteOnEvent | NoteOffEvent;
export type NoteHandler = (event: NoteEvent) => void;
