/**
 * The Cue level (windsor#907): the gain of the engine's aux fader, which
 * carries the chord audition and the metronome past the song master. A
 * console preference kept in `localStorage`, never song data, in the shape of
 * `ccTakeover.ts`: unity whenever storage is empty, holds anything outside
 * the knob's range, or refuses. The session keeps the last value set, so a
 * storage that refuses still carries a turn to the next `AudioSystem`.
 */
import { CUE_LEVEL, CUE_LEVEL_STORAGE_KEY, type CueLevelTable } from './cueLevelTables';

/** The part of `Storage` the preference uses. */
export type CueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The browser's `localStorage`, read lazily so a throwing accessor is caught. */
const browserStorage = (): CueStorage => localStorage;

/** `text` as a gain the knob can show, or null. */
export function parseCueLevel(
  text: string | null,
  table: CueLevelTable = CUE_LEVEL,
): number | null {
  if (text === null || text.trim() === '') return null;
  const gain = Number(text);
  return Number.isFinite(gain) && gain >= table.min && gain <= table.max ? gain : null;
}

/** The stored gain, or unity on anything else or any failure. */
export function readCueLevel(
  storage: () => CueStorage = browserStorage,
  key = CUE_LEVEL_STORAGE_KEY,
): number {
  try {
    return parseCueLevel(storage().getItem(key)) ?? CUE_LEVEL.def;
  } catch {
    return CUE_LEVEL.def;
  }
}

/** Keep the gain; a storage that refuses keeps it for this session only. */
export function writeCueLevel(
  gain: number,
  storage: () => CueStorage = browserStorage,
  key = CUE_LEVEL_STORAGE_KEY,
): void {
  try {
    storage().setItem(key, String(gain));
  } catch {
    // Storage blocked (private window, file:// policy): the session keeps the level.
  }
}

let session: number | null = null;

/** The level this session plays at: the last one set, else the stored one. */
export function cueLevel(): number {
  session ??= readCueLevel();
  return session;
}

/** Set the session's level and store it. */
export function setCueLevel(gain: number): void {
  session = gain;
  writeCueLevel(gain);
}
