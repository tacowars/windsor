/**
 * Which chord a harmony card ▶ sounds, and its notes (windsor#332 decision
 * 5). The selected degree's ▶ plays the selected block as written — degree,
 * size, quality and accidental; every other ▶ plays the scale's own chord at
 * its degree, at the selected block's size. The stack is the engine's
 * `eventStack`, the rule every performer reads, voiced close in root position
 * from the key root in octave 4, with the stack's root doubled an octave
 * below. A note outside MIDI is dropped, never clamped, as `voiceChord` does.
 */
import type { Harmony, HarmonyEvent } from '@windsor/engine';
import {
  MIDI_NOTE_MAX,
  SEMITONES_PER_OCTAVE,
  eventStack,
  scaleOffsets,
  voiceChord,
} from '@windsor/engine';
import {
  HARMONY_AUDITION_BASS_OCTAVES,
  HARMONY_AUDITION_KEY_OCTAVE_NOTE,
} from './harmonyAuditionTables';
import { eventLabel, type EventLabel } from './harmonyLaneModel';

export interface AuditionChord {
  /** MIDI notes, ascending, without duplicates. */
  readonly notes: number[];
  /** What the info bubble shows while the chord sounds. */
  readonly label: EventLabel;
}

export interface AuditionVoicing {
  /** The MIDI note the key root's octave starts at. */
  readonly keyOctaveNote: number;
  /** Octaves below the close chord the root is doubled. */
  readonly bassOctaves: number;
}

const SHIPPED_VOICING: AuditionVoicing = {
  keyOctaveNote: HARMONY_AUDITION_KEY_OCTAVE_NOTE,
  bassOctaves: HARMONY_AUDITION_BASS_OCTAVES,
};

/** The chord degree `degree`'s ▶ plays: `event` itself on its own degree, else the scale's own chord at its size. */
export function auditionEvent(event: HarmonyEvent, degree: number): HarmonyEvent {
  if (degree === event.degree) return event;
  return { start: event.start, duration: event.duration, degree, size: event.size };
}

/** The notes and label of degree `degree`'s ▶, with `event` the selected block. */
export function auditionChord(
  harmony: Harmony,
  event: HarmonyEvent,
  degree: number,
  voicing: AuditionVoicing = SHIPPED_VOICING,
): AuditionChord {
  const played = auditionEvent(event, degree);
  const stack = eventStack(scaleOffsets(harmony.scale), played);
  const rootNote = voicing.keyOctaveNote + harmony.root;
  const close = voiceChord(stack, { inversion: 0, voicing: 'close', octave: 0 }, rootNote);
  const bass = rootNote + (stack[0] ?? 0) - voicing.bassOctaves * SEMITONES_PER_OCTAVE;
  const notes = bass >= 0 && bass <= MIDI_NOTE_MAX ? [bass, ...close] : close;
  return {
    notes: [...new Set(notes)].sort((a, b) => a - b),
    label: eventLabel(harmony, played),
  };
}
