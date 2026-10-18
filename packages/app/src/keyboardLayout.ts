/**
 * The audition keyboard's geometry (windsor#863, record
 * `2026-10-17-the-keyboard-on-a-tablet` decisions 5, 6 and 10, amended by
 * `2026-10-17-keyboard-geometry-follows-the-layout`): which key lies under a
 * point, how hard a point strikes it, and how many octaves a keys box shows.
 * Pure over boxes read from the page once, so a pointer's move never reads
 * the DOM and every rule is tested in Node.
 */
import { SEMITONES_PER_OCTAVE } from '@windsor/engine';
import { pitchClass } from './consoleFormat';
import {
  BLACK_KEYS,
  KEY_OCTAVES,
  TOUCH_VELOCITY,
  WHITE_KEY_MIN_PX,
  WHITES_PER_OCTAVE,
} from './keyboardConstants';
import type { KeysPick, StrikeVelocityTable } from './keyboardConstants';

/** A point in the page's client coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A box in client coordinates, the part of a `DOMRect` the layout reads. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** One key of a row as laid out: its offset from the row's C, its colour and its box. */
export interface KeyBox extends Box {
  readonly offset: number;
  readonly black: boolean;
}

/** Whether the key `offset` semitones above the row's C is a black key. */
export const isBlackKey = (offset: number): boolean => BLACK_KEYS.has(pitchClass(offset));

/** How many white keys the first `count` keys of a row hold. */
export function whiteCount(count: number): number {
  let whites = 0;
  for (let offset = 0; offset < count; offset++) if (!isBlackKey(offset)) whites++;
  return whites;
}

/** The index of the white key a black key at `offset` lies after, counted from the row's first white. */
export const afterWhite = (offset: number): number => whiteCount(offset) - 1;

const contains = (box: Box, { x, y }: Point): boolean =>
  x >= box.left && x < box.right && y >= box.top && y < box.bottom;

/**
 * The key under `point`, or null off every key. Black keys are tested first,
 * since they lie on top of the whites.
 */
export function keyAt(point: Point, keys: readonly KeyBox[]): KeyBox | null {
  return (
    keys.find((key) => key.black && contains(key, point)) ??
    keys.find((key) => !key.black && contains(key, point)) ??
    null
  );
}

/**
 * A touch or pen strike's velocity: the floor at the box's top edge, full at
 * its bottom edge, linear, clamped to that range for a point outside the box.
 * A black key reads over its own box, a white key over its whole height.
 */
export function strikeVelocity(
  point: Point,
  box: Box,
  table: StrikeVelocityTable = TOUCH_VELOCITY,
): number {
  const height = box.bottom - box.top;
  const down = height > 0 ? (point.y - box.top) / height : 0;
  return table.floor + (table.full - table.floor) * Math.min(1, Math.max(0, down));
}

/**
 * What a row of a pick is counted in where the geometry counts keys across:
 * its white keys unfolded, and a fold's slots folded (record
 * `2026-10-18-keyboard-fold` decision 4, `foldSlots` in `keyboardFold.ts`).
 */
export type RowSlots = (pick: KeysPick) => number;

/** An unfolded row's slots: its white keys. */
export const whiteSlots: RowSlots = (pick) => (WHITES_PER_OCTAVE * pick.octaves) / pick.rows;

/** The Parts row's octaves in its one row. */
const ROW_PICK: KeysPick = { octaves: KEY_OCTAVES, rows: 1 };

/**
 * The octaves a touch keys box shows at `boxWidthPx` (record decision 10):
 * all of the row's when their slots (white keys, or a fold's keys) fit at the
 * minimum width, else one.
 */
export function octavesFor(
  boxWidthPx: number,
  slots: RowSlots = whiteSlots,
  whiteMinPx = WHITE_KEY_MIN_PX,
): number {
  return boxWidthPx >= slots(ROW_PICK) * whiteMinPx ? KEY_OCTAVES : 1;
}

/**
 * The slots a touch keys box keeps room for, its minimum width over the
 * touch minimum (record `2026-10-18-keyboard-fold` decision 4, Decided 6):
 * the unfolded row's white keys or the folded row's `keys`, the larger, so
 * the buttons never come back beside fewer keys, and a fold whose keys need
 * more than the line's room wraps Enable MIDI. CSS caps it at the row.
 */
export const rowMinSlots = (keys: number): number => Math.max(whiteSlots(ROW_PICK), keys);

/** The keys `octaves` octaves hold. */
export const keyCountFor = (octaves: number): number => octaves * SEMITONES_PER_OCTAVE;
