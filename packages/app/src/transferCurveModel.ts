/**
 * The transfer curve's geometry (windsor#194 decision 7; record
 * `2026-09-30-master-column-and-meters`, decision 8): the path of the
 * output stage's static curve, the engine's own `outputStageCurve`, on a
 * square of `minDb` to `maxDb` on both axes, the ceiling's height, and where
 * the input-peak dot sits on the curve. Values in, values out;
 * `transferCurve.ts` draws what this returns.
 */
import { outputStageCurve, type OutputStageMode } from '@windsor/engine';
import { TRANSFER_CURVE, TRANSFER_DECIMALS, type TransferCurveTable } from './masterColumnTables';
import { amplitudeToDb, dbToAmplitude } from './meterModel';

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** A dB value's place across the square, in view units from the left. */
export function curveX(db: number, table: TransferCurveTable = TRANSFER_CURVE): number {
  const span = (clamp(db, table.minDb, table.maxDb) - table.minDb) / (table.maxDb - table.minDb);
  return span * table.view;
}

/** A dB value's place up the square, in view units from the top. */
export function curveY(db: number, table: TransferCurveTable = TRANSFER_CURVE): number {
  return table.view - curveX(db, table);
}

/** What the stage makes of a steady input at `inDb`, in dB, at a ceiling of `ceilingDb`. */
export function transferDb(mode: OutputStageMode, ceilingDb: number, inDb: number): number {
  return amplitudeToDb(outputStageCurve(mode, dbToAmplitude(ceilingDb), dbToAmplitude(inDb)));
}

/** The curve's SVG path, sampled every `stepDb` from `minDb` to `maxDb`. */
export function transferPath(
  mode: OutputStageMode,
  ceilingDb: number,
  table: TransferCurveTable = TRANSFER_CURVE,
): string {
  const points: string[] = [];
  const steps = Math.round((table.maxDb - table.minDb) / table.stepDb);
  for (let i = 0; i <= steps; i++) {
    const inDb = table.minDb + i * table.stepDb;
    const x = curveX(inDb, table).toFixed(TRANSFER_DECIMALS);
    const y = curveY(transferDb(mode, ceilingDb, inDb), table).toFixed(TRANSFER_DECIMALS);
    points.push(`${i === 0 ? 'M' : 'L'}${x} ${y}`);
  }
  return points.join('');
}

/** Where the input-peak dot sits for a linear peak, or `null` below the square. */
export function transferDot(
  mode: OutputStageMode,
  ceilingDb: number,
  inputPeak: number,
  table: TransferCurveTable = TRANSFER_CURVE,
): { x: number; y: number } | null {
  const inDb = amplitudeToDb(inputPeak);
  if (!(inDb > table.minDb)) return null;
  const shown = Math.min(inDb, table.maxDb);
  return { x: curveX(shown, table), y: curveY(transferDb(mode, ceilingDb, shown), table) };
}

/** What the curve says to assistive tech: the mode, and its ceiling where it has one. */
export function transferLabel(modeLabel: string, mode: OutputStageMode, ceilingDb: number): string {
  if (mode === 'off') return `Transfer curve: ${modeLabel}, no ceiling`;
  return `Transfer curve: ${modeLabel}, ceiling ${ceilingDb.toFixed(1)} dBFS`;
}
