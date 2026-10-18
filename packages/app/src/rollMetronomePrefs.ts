/**
 * The Roll's metronome on or off (windsor#906 decision 3): a console
 * preference kept in `localStorage`, never song data, in the shape of
 * `ccTakeover.ts`. Off whenever storage is empty, holds anything else, or
 * refuses.
 */
import { ROLL_METRONOME } from './rollTables';

/** The part of `Storage` the preference uses. */
export type MetronomeStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The browser's `localStorage`, read lazily so a throwing accessor is caught. */
const browserStorage = (): MetronomeStorage => localStorage;

const ON = 'on';
const OFF = 'off';

/** The stored switch: on only when storage says so, off otherwise or on any failure. */
export function readMetronomeOn(
  storage: () => MetronomeStorage = browserStorage,
  key: string = ROLL_METRONOME.storageKey,
): boolean {
  try {
    return storage().getItem(key) === ON;
  } catch {
    return false;
  }
}

/** Keep the switch; a storage that refuses keeps it for this session only, in the host. */
export function writeMetronomeOn(
  on: boolean,
  storage: () => MetronomeStorage = browserStorage,
  key: string = ROLL_METRONOME.storageKey,
): void {
  try {
    storage().setItem(key, on ? ON : OFF);
  } catch {
    // Storage blocked (private window, file:// policy): the host keeps the choice.
  }
}
