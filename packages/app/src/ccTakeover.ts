/**
 * The console's CC takeover (windsor#783, record `2026-10-13-midi-cc-mapping`
 * decision 7): **Pickup**, where a hardware knob does nothing until it
 * reaches or crosses the target's value, or **Jump**, where every value
 * applies at once. A console preference kept in `localStorage`, never song
 * data, and Pickup whenever storage is empty or refuses.
 */
import { CC_TAKEOVER_STORAGE_KEY } from './midiConstants';

export type CcTakeover = 'pickup' | 'jump';

/** The part of `Storage` the preference uses. */
export type TakeoverStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The browser's `localStorage`, read lazily so a throwing accessor is caught. */
const browserStorage = (): TakeoverStorage => localStorage;

/** The stored takeover: Jump only when storage says so, Pickup otherwise or on any failure. */
export function readTakeover(
  storage: () => TakeoverStorage = browserStorage,
  key = CC_TAKEOVER_STORAGE_KEY,
): CcTakeover {
  try {
    return storage().getItem(key) === 'jump' ? 'jump' : 'pickup';
  } catch {
    return 'pickup';
  }
}

/** Keep the takeover; a storage that refuses keeps it for this session only, in the router. */
export function writeTakeover(
  takeover: CcTakeover,
  storage: () => TakeoverStorage = browserStorage,
  key = CC_TAKEOVER_STORAGE_KEY,
): void {
  try {
    storage().setItem(key, takeover);
  } catch {
    // Storage blocked (private window, file:// policy): the router keeps the choice.
  }
}
