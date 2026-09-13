/**
 * Decode one Web MIDI message (#523). Web MIDI delivers whole messages with
 * their status byte, so running status never reaches here. Every channel is
 * accepted (omni). Anything the console does not play — aftertouch, program
 * change, other controllers, system messages — decodes to null.
 */
import {
  BEND_CENTRE,
  BEND_RANGE_SEMITONES,
  BEND_SPAN,
  CC_MOD_WHEEL,
  CC_SUSTAIN,
  DATA_MAX,
  STATUS_CONTROL_CHANGE,
  STATUS_NOTE_OFF,
  STATUS_NOTE_ON,
  STATUS_PITCH_BEND,
  SUSTAIN_ON_AT,
} from './midiConstants';

export type MidiEvent =
  | { type: 'noteOn'; note: number; velocity: number }
  | { type: 'noteOff'; note: number }
  | { type: 'sustain'; down: boolean }
  | { type: 'modWheel'; value: number }
  | { type: 'bend'; semitones: number };

const DATA_BITS = 7;
const STATUS_MASK = 0xf0;

export function decodeMidi(
  data: ArrayLike<number>,
  bendRange: number = BEND_RANGE_SEMITONES,
): MidiEvent | null {
  const status = (data[0] ?? 0) & STATUS_MASK;
  const a = (data[1] ?? 0) & DATA_MAX;
  const b = (data[2] ?? 0) & DATA_MAX;
  switch (status) {
    case STATUS_NOTE_ON:
      // Velocity 0 is a note-off: many controllers never send 0x80 at all.
      return b === 0
        ? { type: 'noteOff', note: a }
        : { type: 'noteOn', note: a, velocity: b / DATA_MAX };
    case STATUS_NOTE_OFF:
      return { type: 'noteOff', note: a };
    case STATUS_CONTROL_CHANGE:
      if (a === CC_MOD_WHEEL) return { type: 'modWheel', value: b / DATA_MAX };
      if (a === CC_SUSTAIN) return { type: 'sustain', down: b >= SUSTAIN_ON_AT };
      return null;
    case STATUS_PITCH_BEND: {
      const raw = (b << DATA_BITS) | a;
      const norm = Math.max(-1, Math.min(1, (raw - BEND_CENTRE) / BEND_SPAN));
      return { type: 'bend', semitones: norm * bendRange };
    }
    default:
      return null;
  }
}
