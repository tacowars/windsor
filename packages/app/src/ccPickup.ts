/**
 * Pickup for one mapping and one source key (windsor#783, record
 * `2026-10-13-midi-cc-mapping` decision 7): what one controller value does
 * to that key's state, and whether it applies.
 *
 * - **The key** is the device name and the channel the value came from, so
 *   two devices, or one device on two channels, pick up apart.
 * - **Pickup.** A key picks up when its value reaches the target's position,
 *   within `CC_PICKUP_REACH`, or crosses it between two values heard since
 *   it was armed. The position is the target's current value in CC space
 *   (`ccPosition`), so it is null for `min === max` and every value applies.
 * - **Arming** forgets the value a crossing would start from, so the first
 *   message after any re-arm applies only where it reaches the position: a
 *   knob moved past it meanwhile cannot jump the target.
 * - **Jump** applies every value.
 */
import { CC_PICKUP_REACH } from './midiConstants';
import type { CcTakeover } from './ccTakeover';

/** One key's pickup state: it exists once the key has sent a value. */
export interface CcKeyState {
  readonly device: string | null;
  readonly channel: number;
  /** The last value heard: the hollow marker's position. */
  readonly heard: number;
  /** The last value heard since the key was armed, where a crossing starts; null right after. */
  readonly since: number | null;
  /** Whether the key has picked up, so each value it sends applies. */
  readonly picked: boolean;
}

/** A key's identity in a mapping's map of keys: its device name and channel. */
export const ccKey = (device: string | null, channel: number): string =>
  JSON.stringify([device, channel]);

/**
 * Whether `value` reaches `position`, or crosses it coming from `since`.
 * A null position (`min === max`) has nothing to cross, so every value does.
 */
export function reachesPosition(
  position: number | null,
  value: number,
  since: number | null,
  reach = CC_PICKUP_REACH,
): boolean {
  if (position === null || Math.abs(value - position) <= reach) return true;
  return since !== null && (since - position) * (value - position) <= 0;
}

/** The key's state armed again: not picked, and no value to cross from. */
export const armKey = (state: CcKeyState): CcKeyState => ({ ...state, since: null, picked: false });

/** What one value from a key does: its new state, and whether the value applies. */
export interface PickupStep {
  readonly state: CcKeyState;
  readonly apply: boolean;
}

/** The value a key sent, at `channel` from `device`. */
export interface KeyValue {
  readonly device: string | null;
  readonly channel: number;
  readonly value: number;
}

/**
 * One value from a key whose earlier state is `state` (undefined for a key
 * not heard since it was last forgotten), against the target's `position`.
 */
export function pickupStep(
  state: CcKeyState | undefined,
  heard: KeyValue,
  position: number | null,
  takeover: CcTakeover,
): PickupStep {
  const apply =
    takeover === 'jump' ||
    state?.picked === true ||
    reachesPosition(position, heard.value, state?.since ?? null);
  return {
    state: {
      device: heard.device,
      channel: heard.channel,
      heard: heard.value,
      since: heard.value,
      picked: apply,
    },
    apply,
  };
}

/** A value heard while the mapping cannot play (inert or automated): the marker moves, nothing picks up. */
export const heardOnly = (state: CcKeyState | undefined, heard: KeyValue): CcKeyState => ({
  device: heard.device,
  channel: heard.channel,
  heard: heard.value,
  since: heard.value,
  picked: state?.picked ?? false,
});
