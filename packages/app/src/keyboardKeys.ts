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
 *
 * Folded (windsor#919, record `2026-10-18-keyboard-fold` decision 4), a row
 * is one equal key per tone of the fold's set, with no black keys, each
 * named, the root named with its octave; on Scale the chord's tones carry a
 * strip, and a key past the range is hatched.
 */
import { SEMITONES_PER_OCTAVE } from '@windsor/engine';
import { pitchClass } from './consoleFormat';
import { el } from './dom';
import {
  COARSE_POINTER_QUERY,
  FOLD_LABELS,
  KEY_OCTAVES,
  TOUCH_ROW_CSS,
  VIEW_CSS,
} from './keyboardConstants';
import type { KeysPick } from './keyboardConstants';
import type { FoldKey, FoldedKeys } from './keyboardFold';
import { foldedKeys } from './keyboardFold';
import type { FoldNow } from './keyboardFoldNow';
import { rowSlotsOf } from './keyboardFoldNow';
import type { RowSlots } from './keyboardLayout';
import { octaveMaxFor } from './keyboardViewModel';
import {
  afterWhite,
  isBlackKey,
  keyCountFor,
  octavesFor,
  rowMinSlots,
  whiteCount,
} from './keyboardLayout';

/** How a box lays its keys out: how many octaves, and in how many rows. */
export type KeysShape = KeysPick;

/** The Parts row's two octaves, the shape a box takes while its room cannot be read. */
export const DEFAULT_SHAPE: KeysShape = { octaves: KEY_OCTAVES, rows: 1 };

export const sameShape = (a: KeysShape, b: KeysShape): boolean =>
  a.octaves === b.octaves && a.rows === b.rows;

/** A box the keys render into. */
export interface KeysSurface {
  readonly box: HTMLElement;
  /** True when the rows are the box's children (the expanded view); false when the box is the row. */
  readonly nested: boolean;
  /** The shape its room takes now for a row counted in `slots`, or null while it is hidden. */
  shape(slots: RowSlots): KeysShape | null;
  /** Told after every build, so a bar beside the keys shows the pick they were built in. */
  built?(): void;
}

/** A folded build: the fold as it stands and the keys `foldedKeys` lays out for it. */
export interface FoldedBuild {
  readonly now: FoldNow;
  readonly keys: FoldedKeys;
}

/** What a render built: the keys by offset, and the C names by octave. */
export interface BuiltKeys {
  readonly keys: HTMLElement[];
  readonly names: HTMLElement[];
}

/** What a build laid out besides the keys, which the keyboard plays them by. */
export interface KeysLaid {
  /** The octaves the keys span, which bound the octave. */
  readonly octaves: number;
  /** Each folded key's note by offset; null for the chromatic keys. */
  readonly notes: readonly number[] | null;
  /** The octave label of folded keys: the first key with its own octave. */
  readonly label: string;
  /** True when a fold's rename built them: a chord change or a Fold switch. */
  readonly renamed: boolean;
}

/** The chromatic keys `count` keys span. */
export const chromaticLaid = (count: number): KeysLaid => ({
  octaves: Math.ceil(count / SEMITONES_PER_OCTAVE),
  notes: null,
  label: '',
  renamed: false,
});

/** One build: the keys and C names, the shape they took, and what they play. */
export interface LaidKeys extends BuiltKeys {
  readonly shape: KeysShape;
  readonly laid: KeysLaid;
}

/**
 * Build the keys into `surface` for the fold `now` (null unfolded) at
 * `octave`: the shape its room takes for the fold's slots, the octave
 * bounded by the octaves that shape shows, and the fold's keys or the
 * chromatic ones. `renamed` is the caller's: the set changed since its last
 * build.
 */
export function layKeys(
  surface: KeysSurface,
  now: FoldNow | null,
  octave: number,
  renamed: boolean,
): LaidKeys {
  const shape = surface.shape(rowSlotsOf(now)) ?? DEFAULT_SHAPE;
  const bounded = Math.min(octave, octaveMaxFor(shape.octaves));
  const folded = now ? foldedKeys(now.set, { octave: bounded, ...shape }) : null;
  const built = buildKeys(surface, shape, now && folded ? { now, keys: folded } : null);
  if (!folded)
    return { ...built, shape, laid: { ...chromaticLaid(0), octaves: shape.octaves, renamed } };
  const notes = folded.rows.flat().map((key) => key.note);
  return { ...built, shape, laid: { octaves: shape.octaves, notes, label: folded.label, renamed } };
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
    shape: (slots) => {
      const room = roomFor(box);
      // The Parts tab is hidden: its row's 0 px less the padding.
      if (room <= 0) return null;
      const coarse = matchMedia(COARSE_POINTER_QUERY).matches;
      return { octaves: coarse ? octavesFor(room, slots) : KEY_OCTAVES, rows: 1 };
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

/** A folded key's name: its letter, and the root's octave too (Decided 1). */
export const foldKeyName = (key: FoldKey): string =>
  key.root ? `${key.name}${Math.floor(key.note / SEMITONES_PER_OCTAVE)}` : key.name;

/** One folded key at `offset`: named, the root marked, a chord tone striped, past the range hatched. */
function foldKeyEl(key: FoldKey, offset: number, strip: ReadonlySet<number>): HTMLElement {
  const node = el('div', 'key');
  node.dataset.offset = String(offset);
  if (key.root) node.dataset.root = '1';
  if (strip.has(pitchClass(key.note))) node.dataset.chordTone = '1';
  if (key.outOfRange) {
    node.dataset.out = '1';
    node.title = FOLD_LABELS.outOfRange;
  }
  node.append(el('span', 'kb-name', foldKeyName(key)));
  return node;
}

/** Empty `box` and write the custom properties its CSS lays the keys out from. */
function resetBox(box: HTMLElement, nested: boolean, folded: number | null): void {
  box.innerHTML = '';
  for (const [name, value] of Object.entries(nested ? VIEW_CSS : TOUCH_ROW_CSS))
    box.style.setProperty(name, value);
  box.toggleAttribute('data-folded', folded !== null);
  if (folded === null) box.style.removeProperty('--slots');
  else box.style.setProperty('--slots', String(rowMinSlots(folded)));
}

/** Lay `rows` out in `box`: the box itself one row, or a `.kb-row` each, the lowest at the bottom. */
function layRows(surface: KeysSurface, rows: readonly HTMLElement[][], whites: number): void {
  if (!surface.nested) {
    surface.box.style.setProperty('--whites', String(whites));
    surface.box.append(...rows.flat());
    return;
  }
  for (const keys of [...rows].reverse()) {
    const line = el('div', 'kb-row');
    line.style.setProperty('--whites', String(whites));
    line.append(...keys);
    surface.box.append(line);
  }
}

/** Build a fold's keys into `surface`'s box, offsets running on from the lowest row. */
function buildFolded(surface: KeysSurface, fold: FoldedBuild): BuiltKeys {
  let offset = 0;
  const rows = fold.keys.rows.map((row) =>
    row.map((key) => foldKeyEl(key, offset++, fold.now.strip)),
  );
  resetBox(surface.box, surface.nested, rows.flat().length);
  layRows(surface, rows, rows[0]?.length ?? 0);
  return { keys: rows.flat(), names: [] };
}

/**
 * Build `shape`'s keys into `surface`'s box, with the custom properties its
 * CSS lays them out from: the fold's keys when `fold` is given, else the
 * chromatic keys, each view row's C named.
 */
export function buildKeys(
  surface: KeysSurface,
  shape: KeysShape,
  fold: FoldedBuild | null = null,
): BuiltKeys {
  if (fold) return buildFolded(surface, fold);
  const count = keyCountFor(shape.octaves);
  const perRow = count / shape.rows;
  const keys: HTMLElement[] = [];
  const names: HTMLElement[] = [];
  for (let offset = 0; offset < count; offset++) {
    const key = keyEl(offset, perRow);
    if (surface.nested && pitchClass(offset) === 0)
      names.push(key.appendChild(el('span', 'kb-name')));
    keys.push(key);
  }
  resetBox(surface.box, surface.nested, null);
  const rows = Array.from({ length: shape.rows }, (_, row) =>
    keys.slice(row * perRow, (row + 1) * perRow),
  );
  layRows(surface, rows, whiteCount(perRow));
  return { keys, names };
}
