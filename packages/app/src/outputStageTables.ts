/**
 * The master strip's output stage section and the top-bar light (windsor#94):
 * the mode labels, the Ceiling knob over the engine's range and default, and
 * the meters' scales. The peak bars share the master meter's dBFS scale, so an
 * input and an output reading line up with the pre-stage meter above them.
 */
import { DEFAULT_OUTPUT_STAGE, OUTPUT_CEILING_DB, PEAK_METER } from '@windsor/engine';
import type { OutputStageMode } from '@windsor/engine';
import type { CardKnobSpec } from './sequencerKnobTables';

/** What the mode selector and the light's tooltip call each mode, in the engine's order. */
export const OUTPUT_MODE_LABELS: Readonly<Record<OutputStageMode, string>> = {
  limiter: 'Limiter',
  soft: 'Soft clip',
  hard: 'Hard clip',
  off: 'Off',
};

/** The ceiling in dBFS, a tenth of a dB at a time. */
export const OUTPUT_CEILING_STEP_DB = 0.1;
export const OUTPUT_CEILING_KNOB: CardKnobSpec = {
  label: 'Ceiling',
  min: OUTPUT_CEILING_DB.min,
  max: OUTPUT_CEILING_DB.max,
  def: DEFAULT_OUTPUT_STAGE.ceilingDb,
  step: OUTPUT_CEILING_STEP_DB,
  fmt: (v) => `${v.toFixed(1)} dBFS`,
};

/** The peak bars' scale in dBFS: the master meter's. */
export const OUTPUT_PEAK_SCALE = {
  floorDb: PEAK_METER.floorDb,
  ceilingDb: PEAK_METER.ceilingDb,
} as const;

/** The gain-reduction and over-ceiling bars read 0 dB to this. */
export const OUTPUT_GAUGE_MAX_DB = 12;

/** A sample above this (linear, 0 dBFS) latches the clip light in Off mode (decision 3). */
export const OUTPUT_OFF_CLIP_LEVEL = PEAK_METER.overload;

/** How long the top-bar light glows after the stage last acted, in milliseconds. */
export const OUTPUT_LIGHT_HOLD_MS = PEAK_METER.holdSeconds * 1000;

/** How long a peak readout holds its highest value, in milliseconds. */
export const OUTPUT_READOUT_HOLD_MS = PEAK_METER.holdSeconds * 1000;
