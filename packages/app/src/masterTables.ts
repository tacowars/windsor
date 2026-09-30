/**
 * The master's Level fader (windsor#194 decision 6) and the dBFS reading the
 * song mixer's lights share (#666). The fader stores the linear
 * `master.level` over the Level knob's range, 0 to `STRIP_LEVEL_MAX`, so the
 * song format is unchanged; its travel follows the meter scale.
 */
import { DEFAULT_MASTER, PEAK_METER } from '@windsor/engine';
import { DRAG_RANGE_FINE_PX, DRAG_RANGE_PX, KEY_STEP, KEY_STEP_FINE } from './knobConstants';
import { STRIP_LEVEL_MAX } from './mixerTables';

export interface LevelFaderTable {
  /** The fader's name: its undo step, `aria-label` and title. */
  readonly label: string;
  /** The linear level at the top of the travel; the bottom is 0 (−∞ dB). */
  readonly max: number;
  /** What a double-click resets to. */
  readonly def: number;
  /** How many times slower a Shift-drag moves than a drag, which follows the pointer. */
  readonly fineFactor: number;
  /** An arrow key's share of the travel, and Shift's finer share. */
  readonly keyStep: number;
  readonly keyStepFine: number;
}

/** The knob's range, default, fine ratio and key steps, on a fader. */
export const MASTER_LEVEL_FADER: LevelFaderTable = {
  label: 'Master level',
  max: STRIP_LEVEL_MAX,
  def: DEFAULT_MASTER.level,
  fineFactor: DRAG_RANGE_FINE_PX / DRAG_RANGE_PX,
  keyStep: KEY_STEP,
  keyStepFine: KEY_STEP_FINE,
};

const AMPLITUDE_DB_SCALE = 20;
export const amplitudeDb = (value: number): number =>
  value > 0 ? AMPLITUDE_DB_SCALE * Math.log10(value) : PEAK_METER.floorDb;
