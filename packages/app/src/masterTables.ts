/** Master controls use the engine's default and range; meter amplitudes are dBFS (#666). */
import { DEFAULT_MASTER, PEAK_METER } from '@windsor/engine';
import { STRIP_LEVEL_KNOB } from './mixerTables';
export const MASTER_LEVEL_KNOB = { ...STRIP_LEVEL_KNOB, def: DEFAULT_MASTER.level };
const AMPLITUDE_DB_SCALE = 20;
export const amplitudeDb = (value: number): number =>
  value > 0 ? AMPLITUDE_DB_SCALE * Math.log10(value) : PEAK_METER.floorDb;
