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
  /**
   * Step modulation (windsor#17): the step's parameter offsets, one slot per
   * `VOICE_TARGET_TABLE` row, held for the note's life. Absent when every lane
   * reads 0 on the step, or the generator has none.
   */
  stepMod?: readonly number[];
  /**
   * A ratcheted Grid or Arp step (windsor#366): the note is the roll's first
   * hit, and the binding plays the rest across the step (`rollSpan.ts`).
   * Absent on a plain note, which is one hit.
   */
  roll?: NoteRoll;
}

/**
 * What a ratcheted step asks of its roll: `hits` evenly spaced in seconds
 * across the step's swung span, each later hit the previous one's note-off
 * then a note-on of the same pitch with the step's accent and offsets and
 * no slide. Each hit but an open last one is held `gate` of its slice.
 */
export interface NoteRoll {
  /** Hits in the roll, 2 to `RATCHET_MAX`. */
  readonly hits: number;
  /** The step's length in ticks: the span the hits divide. */
  readonly ticks: number;
  /** Seconds per straight tick at the tempo the step was issued under. */
  readonly secondsPerTick: number;
  /** The fraction of its slice a closed hit is held, in (0, 1]. */
  readonly gate: number;
  /**
   * The last hit is held open, as a plain note is, and the generator
   * releases it with its next note, rest or region end; otherwise it is
   * held `gate` of its slice like the others.
   */
  readonly open: boolean;
}

export interface NoteOffEvent {
  kind: 'noteOff';
  tick: number;
  time: number;
  note: number;
}

export type NoteEvent = NoteOnEvent | NoteOffEvent;
export type NoteHandler = (event: NoteEvent) => void;
