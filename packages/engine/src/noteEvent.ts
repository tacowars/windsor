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
}

export interface NoteOffEvent {
  kind: 'noteOff';
  tick: number;
  time: number;
  note: number;
}

export type NoteEvent = NoteOnEvent | NoteOffEvent;
export type NoteHandler = (event: NoteEvent) => void;
