/** The audition keyboard's tunables (#618): its range, its strike, its keys. */
import { SEMITONES_PER_OCTAVE } from '@windsor/engine';

/** The semitones within an octave that are black keys. */
export const BLACK_KEYS: ReadonlySet<number> = new Set([1, 3, 6, 8, 10]);
/** The octaves of on-screen keys: the row with a fine pointer, and the touch row when it fits. */
export const KEY_OCTAVES = 2;
/** The keys those octaves hold. */
export const KEY_COUNT = KEY_OCTAVES * SEMITONES_PER_OCTAVE;
/** The white keys in one octave. */
export const WHITES_PER_OCTAVE = 7;
/** What the QWERTY row and the mouse strike with; MIDI brings its own. */
export const FIXED_VELOCITY = 0.9;

/**
 * A touch or pen strike's velocity (windsor#863, record
 * `2026-10-17-the-keyboard-on-a-tablet` decision 6): the floor at a key's top
 * edge, full at its bottom edge, linear between. The floor keeps a drum
 * snapping from anywhere on the key. The ear decides these.
 */
export const TOUCH_VELOCITY_FLOOR = 0.6;
export const TOUCH_VELOCITY_FULL = 1.0;

/** The ends of a strike velocity, as `strikeVelocity` takes them. */
export interface StrikeVelocityTable {
  readonly floor: number;
  readonly full: number;
}
export const TOUCH_VELOCITY: StrikeVelocityTable = {
  floor: TOUCH_VELOCITY_FLOOR,
  full: TOUCH_VELOCITY_FULL,
};

/** The media query the touch row is laid out under (record decision 4). */
export const COARSE_POINTER_QUERY = '(any-pointer: coarse)';
/** A black key on the touch row, as a fraction of a white key's width and of its height. */
export const BLACK_KEY_WIDTH = 0.6;
export const BLACK_KEY_HEIGHT = 0.62;
/** The narrowest a white key on the touch row goes while the row has the room. */
export const WHITE_KEY_MIN_PX = 44;
/** The touch row's height. */
export const TOUCH_ROW_PX = 110;

/**
 * The touch row's sizes, written on the keys box as custom properties so
 * `console.css`'s coarse-pointer block reads them from here, not a copy.
 */
export const TOUCH_ROW_CSS: Readonly<Record<string, string>> = {
  '--white-key-min': `${WHITE_KEY_MIN_PX}px`,
  '--black-key-w': String(BLACK_KEY_WIDTH),
  '--black-key-h': String(BLACK_KEY_HEIGHT),
  '--touch-row-h': `${TOUCH_ROW_PX}px`,
};
/** The octave the console opens at, and the `z` / `x` bounds. */
export const OCTAVE_DEFAULT = 4;
export const OCTAVE_MIN = 0;
export const OCTAVE_MAX = 8;
/** Semitone offset from the octave's C for each QWERTY note key. */
export const QWERTY: Readonly<Record<string, number>> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
};

/** The tab whose part the QWERTY keys play: on any other tab they sound nothing (windsor#349). */
export const AUDITION_TAB = 'parts';

/**
 * The expanded keyboard view (windsor#864, record
 * `2026-10-17-the-keyboard-on-a-tablet` decisions 7 and 8): how many octaves
 * its keys show and in how many rows, which the bar's Octaves and Rows pick.
 * Two rows split the octaves evenly, the lower octaves on the lower row.
 */
export interface KeysPick {
  readonly octaves: number;
  readonly rows: number;
}
/** Octaves' options, 1 · 2 · 3 · 4, and Rows', 1 · 2. */
export const VIEW_OCTAVES: readonly number[] = [1, 2, 3, 4];
export const VIEW_ROWS: readonly number[] = [1, 2];
/** The pick the view opens at until one is stored. */
export const VIEW_PICK_DEFAULT: KeysPick = { octaves: 2, rows: 1 };
/** The gap between two rows of keys. */
export const VIEW_ROW_GAP_PX = 12;
/** The view's sizes, written on its keys box as custom properties, as `TOUCH_ROW_CSS` is. */
export const VIEW_CSS: Readonly<Record<string, string>> = {
  '--black-key-w': String(BLACK_KEY_WIDTH),
  '--black-key-h': String(BLACK_KEY_HEIGHT),
  '--kb-row-gap': `${VIEW_ROW_GAP_PX}px`,
};
/** Where the pick is kept: a console preference, never song data (windsor#778 decision 7's pattern). */
export const VIEW_PICK_STORAGE_KEY = 'windsor.keyboard.viewPick';

/** Why an option is dimmed: what a tap on it writes in the bar's hint, and its title. */
export const VIEW_HINTS = {
  needsWidth: (octaves: number): string => `${octaves} octaves needs more width`,
  needsTwoRows: (octaves: number): string => `${octaves} octaves needs 2 rows at this width`,
  evenRows: '2 rows takes 2 or 4 octaves',
};

/** The view's words (US English, windsor#821). */
export const VIEW_LABELS = {
  title: 'Keyboard',
  octaves: 'Octaves',
  rows: 'Rows',
  expand: 'Expand',
  expandTitle: 'Expand: open the keyboard wide',
  close: 'Close',
  closeTitle: 'Close the keyboard (Esc)',
  octDown: 'Oct −',
  octUp: 'Oct +',
  hold: 'Hold',
  panic: 'Panic',
};
/**
 * The Fold control's words and a hatched key's title (windsor#919, record
 * `2026-10-18-keyboard-fold` decisions 2 and 4; US English, windsor#821).
 */
export const FOLD_LABELS = {
  fold: 'Fold',
  off: 'Off',
  scale: 'Scale',
  chord: 'Chord',
  outOfRange: 'Past the engine’s range (127): plays nothing',
};
/** Expand's icon: the Roll rail's expand path (`rollExpand.ts`), in a 12 px box. */
export const EXPAND_ICON_PATH = 'M7 1.5h3.5V5M10.5 1.5 6.8 5.2M5 10.5H1.5V7M1.5 10.5l3.7-3.7';
