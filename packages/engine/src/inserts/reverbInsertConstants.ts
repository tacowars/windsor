/**
 * The Reverb insert's tunables (windsor#171). Its space fields and
 * their ranges are the plate's own (`REVERB_SPACE_RANGES`), and its starting
 * points the preset bank's (`reverbPresets.ts`), stated once for the send bus
 * and the insert alike.
 */

/** A new Reverb on a part or the master starts at this Mix (record `2026-09-30-insert-rack-and-send-bus-chains` §5). */
export const REVERB_MIX_DEFAULT = 0.3;
/**
 * The preset a new Reverb, and Send A's, starts on (windsor#774): Resident,
 * today's `hall` space field for field.
 */
export const REVERB_PRESET_DEFAULT = 1;

/**
 * How many render quanta the plate's `clear` stays up after the switch's fade
 * out ends, before the send and the gate may reopen (fix round 1 for PR
 * #635): `clear` is k-rate, so it must be up at a quantum's start to empty
 * the tank, and two quanta hold one such start whatever the rounding.
 */
export const PLATE_CLEAR_QUANTA = 2;
