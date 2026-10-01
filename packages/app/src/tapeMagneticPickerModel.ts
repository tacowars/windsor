/**
 * The hidden magnetic picker's pure rules (windsor#276): whether the page
 * shows it, its options, and which point each live Tape insert is
 * auditioning. The choice is held per live stage, in this session only: it
 * never reaches the song document, the patch, undo, the autosave or an
 * export, and a stage rebuilt or a page reloaded starts at the model's row
 * again, as the engine does.
 */
import { TAPE_MAGNETIC_CANDIDATES, type TapeMagneticRow } from '@windsor/engine';
import {
  TAPE_DEV_FLAG,
  TAPE_MAGNETIC_DECIMALS,
  TAPE_MAGNETIC_LEAST_ACCURATE,
  TAPE_MAGNETIC_LEAST_ACCURATE_NOTE,
  TAPE_MODEL_ROW_LABEL,
} from './tapeMagneticPickerTables';

/** Whether the page's query string (`location.search`) carries the flag, with any value. */
export function tapeDevEnabled(search: string): boolean {
  return new URLSearchParams(search).has(TAPE_DEV_FLAG);
}

const sameRow = (a: TapeMagneticRow, b: TapeMagneticRow): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** `drive / width / saturation` to two decimals, the least accurate corner marked. */
export function magneticLabel(row: TapeMagneticRow): string {
  const text = row.map((v) => v.toFixed(TAPE_MAGNETIC_DECIMALS)).join(' / ');
  return sameRow(row, TAPE_MAGNETIC_LEAST_ACCURATE)
    ? `${text} ${TAPE_MAGNETIC_LEAST_ACCURATE_NOTE}`
    : text;
}

/** "Model row" (value `''`), then each allowed point, its value its index in `candidates`. */
export function magneticOptions(
  candidates: readonly TapeMagneticRow[] = TAPE_MAGNETIC_CANDIDATES,
): (readonly [value: string, text: string])[] {
  return [
    ['', TAPE_MODEL_ROW_LABEL],
    ...candidates.map((row, i) => [String(i), magneticLabel(row)] as const),
  ];
}

/** The row an option's value names: `null` for the model's row, `undefined` for no option. */
export function magneticRowOf(
  value: string,
  candidates: readonly TapeMagneticRow[] = TAPE_MAGNETIC_CANDIDATES,
): TapeMagneticRow | null | undefined {
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return undefined;
  return candidates[Number(value)];
}

/** Which option each live Tape stage is auditioning. */
export interface MagneticOverrides {
  /** The option `stage` shows: `''` (the model's row) unless a point was sent to it. */
  value(stage: object | undefined): string;
  /**
   * Send `value`'s row to `stage` through `send`, and remember it. Returns
   * false, remembering nothing, when there is no stage, no such option, or
   * `send` refuses.
   */
  choose(
    stage: object | undefined,
    value: string,
    send: (row: TapeMagneticRow | null) => boolean,
  ): boolean;
}

/** A fresh session: keyed by the stage itself, so a rebuilt stage starts at the model's row. */
export function createMagneticOverrides(): MagneticOverrides {
  const chosen = new WeakMap<object, string>();
  return {
    value: (stage) => (stage ? (chosen.get(stage) ?? '') : ''),
    choose(stage, value, send): boolean {
      const row = magneticRowOf(value);
      if (!stage || row === undefined || !send(row)) return false;
      if (row === null) chosen.delete(stage);
      else chosen.set(stage, value);
      return true;
    },
  };
}
