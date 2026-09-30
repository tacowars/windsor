/**
 * The output stage's controls in the Mixer's master column and the top-bar
 * light (windsor#94, windsor#194): the mode labels and what each mode's lamp
 * calls its action, the Ceiling knob over the engine's range and default, and
 * the meters' scales.
 */
import { DEFAULT_OUTPUT_STAGE, OUTPUT_CEILING_DB, PEAK_METER } from '@windsor/engine';
import type { OutputStageMode } from '@windsor/engine';
import type { OutputStageAction } from './outputStageModel';
import type { CardKnobSpec } from './sequencerKnobTables';

/** What the mode selector and the light's tooltip call each mode, in the engine's order. */
export const OUTPUT_MODE_LABELS: Readonly<Record<OutputStageMode, string>> = {
  limiter: 'Limiter',
  soft: 'Soft clip',
  hard: 'Hard clip',
  off: 'Off',
};

/**
 * What the stage lamp names while it is not latched: the current mode's
 * action (record `2026-09-30-master-column-and-meters`, decision 6).
 */
export const OUTPUT_MODE_ACTIONS: Readonly<Record<OutputStageMode, OutputStageAction>> = {
  limiter: 'Limiting',
  soft: 'Clipping',
  hard: 'Clipping',
  off: 'Over 0 dB',
};

/** When each action happens, for the lamp's title. */
export const OUTPUT_ACTION_EVENTS: Readonly<Record<OutputStageAction, string>> = {
  Limiting: 'the limiter turns the level down',
  Clipping: 'the clipper changes a sample',
  'Over 0 dB': 'a sample goes over 0 dBFS',
};

/** The ceiling in dBFS, a tenth of a dB at a time. */
export const OUTPUT_CEILING_STEP_DB = 0.1;
export const formatCeilingDb = (db: number): string => `${db.toFixed(1)} dBFS`;
export const OUTPUT_CEILING_KNOB: CardKnobSpec = {
  label: 'Ceiling',
  min: OUTPUT_CEILING_DB.min,
  max: OUTPUT_CEILING_DB.max,
  def: DEFAULT_OUTPUT_STAGE.ceilingDb,
  step: OUTPUT_CEILING_STEP_DB,
  fmt: formatCeilingDb,
};

/** The peak bars' scale in dBFS: the engine's peak-meter range. */
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
