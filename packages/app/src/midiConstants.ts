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
/**
 * Learn takes a controller once its value moves this many steps from the
 * first value heard for it (windsor#783, record `2026-10-13-midi-cc-mapping`
 * decision 11), so a value dump on connect or a resting knob maps nothing.
 * The controllers learn ignores are the engine's `CC_MAPPING_IGNORED`.
 */
export const CC_LEARN_MIN_MOVE = 3;
/**
 * How close, in controller steps, a value must come to the target's
 * position to pick it up without crossing it (decision 7): a controller
 * sends whole steps and the position is a real number, so the nearest step
 * reaches it.
 */
export const CC_PICKUP_REACH = 0.5;
/** A sustain value at or above this is pedal down (the MIDI 1.0 convention). */
export const SUSTAIN_ON_AT = 64;

/** The low four bits of the status byte: the channel, 0-based on the wire. */
export const CHANNEL_MASK = 0x0f;

/** Seven-bit data maximum: velocity and controller values. */
export const DATA_MAX = 127;
/** Fourteen-bit pitch bend: centre and the largest distance from it. */
export const BEND_CENTRE = 8192;
export const BEND_SPAN = 8191;

/** `localStorage` key for the chosen input, by device name. */
export const INPUT_STORAGE_KEY = 'a204.patchEditor.midiInput';
/** `localStorage` key for the CC takeover, Pickup or Jump (decision 7). */
export const CC_TAKEOVER_STORAGE_KEY = 'windsor.midi.ccTakeover';
