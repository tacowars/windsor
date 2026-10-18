/**
 * The automation catalog's rows for the Dynamics group's kinds (the Add
 * picker's group, `insertKnobTables.ts` in the app): the compressor, Pump
 * and the Transient, as `automationInsertTables.ts` reads them into its
 * table by kind. Moved here whole, rows and comments unchanged, when the
 * Transient's rows took the catalog's file past its size limit (record
 * `2026-10-18-transient-insert`). The stepped compressor fields, Pump's
 * drawn shape, division and source are not targets, as that file says.
 */
import { COMPRESSOR_BOUNDS } from '../inserts/compressorConstants';
import { PUMP_BOUNDS } from '../inserts/pumpConstants';
import type { PumpSpec } from '../inserts/pumpSpec';
import { TRANSIENT_BOUNDS } from '../inserts/transientConstants';
import { row, when } from './automationInsertRow';
import type { InsertFieldRow } from './automationInsertRow';

const C = COMPRESSOR_BOUNDS;
export const COMPRESSOR_ROWS = [
  row('threshold', 'Threshold', C.threshold, 'linear', 'dB'),
  row('makeup', 'Makeup', C.makeup, 'linear', 'dB'),
  row('highpass', 'Detector HPF', C.highpass, 'linear', 'Hz'),
  row('range', 'Range', C.range, 'linear', 'dB'),
  row('mix', 'Mix', C.mix),
];

const PU = PUMP_BOUNDS;
/**
 * The Pump's continuous controls (record `2026-10-13-pump-insert`); its
 * length in ms only while it is not synced. The drawn shape, the division
 * and the source are not targets.
 */
export const PUMP_ROWS: InsertFieldRow<PumpSpec>[] = [
  row('depth', 'Depth', PU.depth),
  when(row('lengthMs', 'Length', PU.lengthMs, 'log', 'ms'), (spec: PumpSpec) => !spec.sync),
  row('sensitivity', 'Sensitivity', PU.sensitivity),
  row('holdMs', 'Hold', PU.holdMs, 'log', 'ms'),
  row('smoothMs', 'Smooth', PU.smoothMs, 'linear', 'ms'),
];

const TR = TRANSIENT_BOUNDS;
/** The Transient's four controls (record `2026-10-18-transient-insert` decision 2), all linear. */
export const TRANSIENT_ROWS = [
  row('attack', 'Attack', TR.attack, 'linear', 'dB'),
  row('sustain', 'Sustain', TR.sustain, 'linear', 'dB'),
  row('output', 'Output', TR.output, 'linear', 'dB'),
  row('mix', 'Mix', TR.mix),
];
