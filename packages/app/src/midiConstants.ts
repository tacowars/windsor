/**
 * MIDI input tunables and wire numbers (#523). tacowars's defaults, 2026-09-13:
 * a ±2 semitone bend, every channel, linear velocity, aftertouch unmapped.
 */

/** Semitones at full pitch-bend deflection, either way. */
export const BEND_RANGE_SEMITONES = 2;

/** Status nibbles (the high four bits of the first byte). */
export const STATUS_NOTE_OFF = 0x80;
export const STATUS_NOTE_ON = 0x90;
export const STATUS_CONTROL_CHANGE = 0xb0;
export const STATUS_PITCH_BEND = 0xe0;

export const CC_MOD_WHEEL = 1;
export const CC_SUSTAIN = 64;
/** A sustain value at or above this is pedal down (the MIDI 1.0 convention). */
export const SUSTAIN_ON_AT = 64;

/** Seven-bit data maximum: velocity and controller values. */
export const DATA_MAX = 127;
/** Fourteen-bit pitch bend: centre and the largest distance from it. */
export const BEND_CENTRE = 8192;
export const BEND_SPAN = 8191;

/** `localStorage` key for the chosen input, by device name. */
export const INPUT_STORAGE_KEY = 'a204.patchEditor.midiInput';
