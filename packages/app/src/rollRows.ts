/**
 * The Roll's rows (windsor#602 decision 4), without the DOM: which pitches
 * the keyboard and the notes pane show, top down, and how tall each is.
 *
 * - **12** shows every semitone of the range.
 * - **Scale** hides the rows outside the key's scale, except a row that
 *   holds a note, which stays as a thin sliver.
 * - **Fold** shows only the rows that hold notes, in pitch order, as tall
 *   as the pane allows up to a ceiling and never shorter than the zoom's
 *   row; it overrides Keys. A roll with no notes has nothing to fold, so it
 *   shows its Keys rows.
 *
 * The range is C1 to C7, widened to any note outside it.
 */
import { SEMITONES_PER_OCTAVE } from '@windsor/engine';
import { ROLL_PITCH_RANGE, ROLL_ROWS } from './rollTables';

/** 12 shows every semitone; Scale only the key's. */
export type RollKeys = '12' | 'scale';

/** One row: its pitch, its top and height in px, and whether it is a thin out-of-scale sliver. */
export interface RollRow {
  readonly pitch: number;
  readonly top: number;
  readonly h: number;
  readonly thin: boolean;
}

/** The rows, top down, and their total height. */
export interface RowLayout {
  readonly rows: readonly RollRow[];
  readonly height: number;
}

/** What the rows are built from. */
export interface RowInput {
  readonly keys: RollKeys;
  readonly fold: boolean;
  /** The ↕ zoom's row height. */
  readonly rowPx: number;
  /** The pitches that hold a note. */
  readonly used: ReadonlySet<number>;
  /** The key's scale as pitch classes. */
  readonly scalePcs: ReadonlySet<number>;
  /** The notes pane's height, which Fold fills. */
  readonly panePx: number;
}

/** The geometry the rows take: `ROLL_ROWS` and `ROLL_PITCH_RANGE` unless a test passes its own. */
export interface RowGeometry {
  readonly thinPx: number;
  readonly foldMaxPx: number;
  readonly low: number;
  readonly high: number;
}

const SHIPPED: RowGeometry = { ...ROLL_ROWS, ...ROLL_PITCH_RANGE };

export const pitchClassOf = (pitch: number): number =>
  ((pitch % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;

/** Whether `pitch` is a C, whose row carries the brighter separator. */
export const isC = (pitch: number): boolean => pitchClassOf(pitch) === 0;

/** The pitches shown, low to high: the range, widened to every used pitch. */
export function pitchSpan(
  used: ReadonlySet<number>,
  geometry: RowGeometry = SHIPPED,
): { low: number; high: number } {
  let { low, high } = geometry;
  for (const pitch of used) {
    low = Math.min(low, pitch);
    high = Math.max(high, pitch);
  }
  return { low, high };
}

function stack(list: readonly Omit<RollRow, 'top'>[]): RowLayout {
  let top = 0;
  const rows = list.map((row) => {
    const placed = { ...row, top };
    top += row.h;
    return placed;
  });
  return { rows, height: top };
}

/** The rows for one view of the roll. */
export function rollRows(input: RowInput, geometry: RowGeometry = SHIPPED): RowLayout {
  const { used, rowPx } = input;
  if (input.fold && used.size > 0) {
    const fill = Math.floor(input.panePx / used.size);
    const h = Math.max(rowPx, Math.min(geometry.foldMaxPx, fill));
    const pitches = [...used].sort((a, b) => b - a);
    return stack(pitches.map((pitch) => ({ pitch, h, thin: false })));
  }
  const { low, high } = pitchSpan(used, geometry);
  const list: Omit<RollRow, 'top'>[] = [];
  for (let pitch = high; pitch >= low; pitch--) {
    if (input.keys === '12' || input.scalePcs.has(pitchClassOf(pitch))) {
      list.push({ pitch, h: rowPx, thin: false });
    } else if (used.has(pitch)) {
      list.push({ pitch, h: geometry.thinPx, thin: true });
    }
  }
  return stack(list);
}

/** The index of the row at `y` px from the top; the last row past the bottom. */
export function rowIndexAt(rows: readonly RollRow[], y: number): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as RollRow;
    if (y < row.top + row.h) return i;
  }
  return rows.length - 1;
}

/** The row nearest `pitch`, which a view opens centred on. */
export function nearestRow(rows: readonly RollRow[], pitch: number): RollRow | undefined {
  let best: RollRow | undefined;
  for (const row of rows) {
    if (!best || Math.abs(row.pitch - pitch) < Math.abs(best.pitch - pitch)) best = row;
  }
  return best;
}

/** Whether a key is named: from `labelPx` up, and a C from `cLabelPx`; never a thin sliver. */
export function keyNamed(row: RollRow, rows = ROLL_ROWS): boolean {
  if (row.thin) return false;
  return row.h >= rows.labelPx || (row.h >= rows.cLabelPx && isC(row.pitch));
}
