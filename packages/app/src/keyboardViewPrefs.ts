/**
 * The expanded keyboard view's Octaves and Rows pick (windsor#864, record
 * `2026-10-17-the-keyboard-on-a-tablet` decision 8): a console preference
 * kept in `localStorage`, never song data, in the shape of `ccTakeover.ts`.
 * The default whenever storage is empty, holds anything but a pick the bar
 * offers, or refuses. What is stored is what the user picked; the view
 * draws the pick its room allows (`normalizePick`).
 */
import {
  VIEW_OCTAVES,
  VIEW_PICK_DEFAULT,
  VIEW_PICK_STORAGE_KEY,
  VIEW_ROWS,
} from './keyboardConstants';
import type { KeysPick } from './keyboardConstants';

/** The part of `Storage` the preference uses. */
export type PickStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The browser's `localStorage`, read lazily so a throwing accessor is caught. */
const browserStorage = (): PickStorage => localStorage;

/** `text` as a pick the bar offers, or null: known octaves and rows that split them evenly. */
function parsePick(text: string | null): KeysPick | null {
  if (text === null) return null;
  const raw = JSON.parse(text) as Partial<Record<keyof KeysPick, unknown>> | null;
  const { octaves, rows } = raw ?? {};
  if (typeof octaves !== 'number' || typeof rows !== 'number') return null;
  if (!VIEW_OCTAVES.includes(octaves) || !VIEW_ROWS.includes(rows)) return null;
  return octaves % rows === 0 ? { octaves, rows } : null;
}

/** The stored pick, or the default on anything else or any failure. */
export function readViewPick(
  storage: () => PickStorage = browserStorage,
  key = VIEW_PICK_STORAGE_KEY,
): KeysPick {
  try {
    return parsePick(storage().getItem(key)) ?? VIEW_PICK_DEFAULT;
  } catch {
    return VIEW_PICK_DEFAULT;
  }
}

/** Keep the pick; a storage that refuses keeps it for this session only, in the open view. */
export function writeViewPick(
  pick: KeysPick,
  storage: () => PickStorage = browserStorage,
  key = VIEW_PICK_STORAGE_KEY,
): void {
  try {
    storage().setItem(key, JSON.stringify({ octaves: pick.octaves, rows: pick.rows }));
  } catch {
    // Storage blocked (private window, file:// policy): the open view keeps the pick.
  }
}
