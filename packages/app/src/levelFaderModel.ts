/**
 * The Level fader's rules (windsor#194 decision 6): where a linear level sits
 * on the fader's travel and back, what a drag and an arrow key make of it,
 * and its readout in dB. The travel is the meter scale's (`meterPosition`),
 * so the fader lines up with the In meters beside it; the bottom is −∞ (a
 * level of 0) and the top is the table's `max`. Values in, values out;
 * `levelFader.ts` draws and wires what this returns.
 */
import { MASTER_LEVEL_FADER, type LevelFaderTable } from './masterTables';
import { amplitudeToDb, dbToAmplitude, meterPosition, peakReadout } from './meterModel';
import { METER_SCALE, type MeterScale } from './meterTables';

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** A linear level's place on the travel, 0 (−∞) to 1 (the top); a level past `max` sits at the top. */
export function faderPosition(level: number, scale: MeterScale = METER_SCALE): number {
  return level > 0 ? meterPosition(amplitudeToDb(level), scale) : 0;
}

/** The linear level at a place on the travel: 0 at the bottom, `max` at the top. */
export function faderLevel(
  position: number,
  table: LevelFaderTable = MASTER_LEVEL_FADER,
  scale: MeterScale = METER_SCALE,
): number {
  const p = clamp01(position);
  if (p === 0) return 0;
  if (p === 1) return table.max;
  const db = scale.floorDb + Math.pow(p, 1 / scale.exponent) * (scale.ceilingDb - scale.floorDb);
  return Math.min(table.max, dbToAmplitude(db));
}

/** A drag: where it started on the travel, how far down it has moved, and the travel's height. */
export interface FaderDrag {
  readonly startPosition: number;
  readonly dyPx: number;
  readonly heightPx: number;
  readonly fine: boolean;
}

/** What a drag sets: the cap follows the pointer, or moves `fineFactor` times slower under Shift. */
export function faderDragLevel(
  drag: FaderDrag,
  table: LevelFaderTable = MASTER_LEVEL_FADER,
): number {
  const range = drag.fine ? drag.heightPx * table.fineFactor : drag.heightPx;
  return faderLevel(drag.startPosition - drag.dyPx / range, table);
}

/** What one arrow key sets: a share of the travel up (`1`) or down (`-1`). */
export function faderKeyLevel(
  level: number,
  dir: 1 | -1,
  fine: boolean,
  table: LevelFaderTable = MASTER_LEVEL_FADER,
): number {
  const step = fine ? table.keyStepFine : table.keyStep;
  return faderLevel(faderPosition(level) + dir * step, table);
}

/** The readout: the level in dB to a tenth with its sign, `−∞` at the bottom. */
export function faderReadout(level: number): string {
  return peakReadout(amplitudeToDb(level));
}

/** The slider's `aria-valuetext`. */
export function faderValueText(level: number): string {
  return `${faderReadout(level)} dB`;
}
