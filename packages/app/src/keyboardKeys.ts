/**
 * The audition keyboard's keys on the page (windsor#863, windsor#864): a box
 * the keys render into, how its room lays them out, and the keys themselves.
 *
 * - The Parts tab's keys row is the box itself, one row; on a touch layout
 *   its row's room sets the octaves it shows (record
 *   `2026-10-17-the-keyboard-on-a-tablet` decision 10).
 * - The expanded view's box holds its rows as siblings, each a keys row of
 *   its own with its own `--whites`, the lower octaves on the lower row and
 *   each C named; the view's pick sets the keys and the rows (decision 8).
 *
 * Offsets run on across rows, so a key is found by its offset wherever it
 * sits, and `keyAt` over the keys' boxes spans the rows.
 */
import { pitchClass } from './consoleFormat';
import { el } from './dom';
import { COARSE_POINTER_QUERY, KEY_COUNT, TOUCH_ROW_CSS, VIEW_CSS } from './keyboardConstants';
import { afterWhite, isBlackKey, keyCountFor, octavesFor, whiteCount } from './keyboardLayout';

/** How a box lays its keys out: how many, and in how many rows. */
export interface KeysShape {
  readonly count: number;
  readonly rows: number;
}

/** The Parts row's two octaves, the shape a box takes while its room cannot be read. */
export const DEFAULT_SHAPE: KeysShape = { count: KEY_COUNT, rows: 1 };

export const sameShape = (a: KeysShape, b: KeysShape): boolean =>
  a.count === b.count && a.rows === b.rows;

/** A box the keys render into. */
export interface KeysSurface {
  readonly box: HTMLElement;
  /** True when the rows are the box's children (the expanded view); false when the box is the row. */
  readonly nested: boolean;
  /** The shape its room takes now, or null while it is hidden. */
  shape(): KeysShape | null;
}

/** What a render built: the keys by offset, and the C names by octave. */
export interface BuiltKeys {
  readonly keys: HTMLElement[];
  readonly names: HTMLElement[];
}

/**
 * The room a Parts row's keys box may take: its row's content width. The box
 * itself is that wide whenever it shows two octaves (its `min-width` is
 * 616 px capped at the row), but at one octave it shares a line with the
 * buttons, so its own width would keep it at one octave on a row that has
 * room for two.
 */
function roomFor(box: HTMLElement): number {
  const row = box.parentElement;
  if (!row) return box.clientWidth;
  const style = getComputedStyle(row);
  return row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

/** The Parts tab's keys row: the octaves its room allows on a touch layout, two with a fine pointer. */
export function homeSurface(box: HTMLElement): KeysSurface {
  return {
    box,
    nested: false,
    shape: () => {
      const room = roomFor(box);
      // The Parts tab is hidden: its row's 0 px less the padding.
      if (room <= 0) return null;
      const coarse = matchMedia(COARSE_POINTER_QUERY).matches;
      return { count: coarse ? keyCountFor(octavesFor(room)) : KEY_COUNT, rows: 1 };
    },
  };
}

/** One key at `offset`, a black key placed in its row of `perRow` keys. */
function keyEl(offset: number, perRow: number): HTMLElement {
  const key = el('div', 'key');
  key.dataset.offset = String(offset);
  if (isBlackKey(offset)) {
    key.dataset.black = '1';
    key.style.setProperty('--after-white', String(afterWhite(offset % perRow)));
  }
  return key;
}

/** Build `shape`'s keys into `surface`'s box, with the custom properties its CSS lays them out from. */
export function buildKeys(surface: KeysSurface, shape: KeysShape): BuiltKeys {
  const { box, nested } = surface;
  const perRow = shape.count / shape.rows;
  const keys: HTMLElement[] = [];
  const names: HTMLElement[] = [];
  for (let offset = 0; offset < shape.count; offset++) {
    const key = keyEl(offset, perRow);
    if (nested && pitchClass(offset) === 0) names.push(key.appendChild(el('span', 'kb-name')));
    keys.push(key);
  }
  box.innerHTML = '';
  for (const [name, value] of Object.entries(nested ? VIEW_CSS : TOUCH_ROW_CSS))
    box.style.setProperty(name, value);
  if (!nested) {
    box.style.setProperty('--whites', String(whiteCount(shape.count)));
    box.append(...keys);
    return { keys, names };
  }
  for (let row = shape.rows - 1; row >= 0; row--) {
    const line = el('div', 'kb-row');
    line.style.setProperty('--whites', String(whiteCount(perRow)));
    line.append(...keys.slice(row * perRow, (row + 1) * perRow));
    box.append(line);
  }
  return { keys, names };
}
