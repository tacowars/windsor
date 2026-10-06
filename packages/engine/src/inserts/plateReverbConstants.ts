/**
 * The Plate reverb insert's tunables (windsor#171). Its space fields and
 * their ranges are the plate's own (`REVERB_SPACE_RANGES`, `SPACES`), stated
 * once for the return and the insert alike.
 */
import type { SpaceName } from '../mixer/reverbSpace';

/** A new Plate reverb on a part or the master starts at this Mix (record `2026-09-30-insert-rack-and-send-bus-chains` §5). */
export const PLATE_REVERB_MIX_DEFAULT = 0.3;
/** The space a new Plate reverb starts in: the `room` return's. */
export const PLATE_REVERB_SPACE_DEFAULT: SpaceName = 'hall';

/**
 * How many render quanta the plate's `clear` stays up after the switch's fade
 * out ends, before the send and the gate may reopen (fix round 1 for PR
 * #635): `clear` is k-rate, so it must be up at a quantum's start to empty
 * the tank, and two quanta hold one such start whatever the rounding.
 */
export const PLATE_CLEAR_QUANTA = 2;
