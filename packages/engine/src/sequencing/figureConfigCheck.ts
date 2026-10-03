/**
 * The check every Figure constructor and live edit runs (windsor#484,
 * record `2026-10-03-figure-sequencer`): the field set of
 * `figureSequencer.ts` within its bounds, each optional process when present.
 * The normaliser (`song/figureNormalise.ts`) returns only configs that pass.
 */
import {
  FIGURE_DRIFT_STEPS_MAX,
  FIGURE_SCHEDULE_BARS_MAX,
  FIGURE_TONE_MAX,
  FIGURE_TRANSPOSE_MAX,
  GRID_STEPS_MAX,
  GRID_STEP_OCTAVE_MAX,
  MUSIC_SLOT_MAX,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '../audioConstants';
import type { FigureCell, FigureSequencerConfig } from './figureSequencer';
import { assertRatchet } from './gridSequencer';
import { isNoteDivisor } from './scheduler';
import { assertStepModLanes } from './stepModLanes';

const isIntIn = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max;

const isUnit = (value: number): boolean => value >= 0 && value <= 1;

function assertCell(cell: FigureCell, index: number): void {
  if (cell.kind !== 'note') return;
  const at = `cells[${index}]`;
  if (!isIntIn(cell.tone, -FIGURE_TONE_MAX, FIGURE_TONE_MAX)) {
    throw new RangeError(`${at}.tone must be an integer within ±${FIGURE_TONE_MAX}`);
  }
  if (!isIntIn(cell.octave, -GRID_STEP_OCTAVE_MAX, GRID_STEP_OCTAVE_MAX)) {
    throw new RangeError(`${at}.octave must be an integer within ±${GRID_STEP_OCTAVE_MAX}`);
  }
  if (cell.velocity !== undefined && !isUnit(cell.velocity)) {
    throw new RangeError(`${at}.velocity must be in [0, 1], got ${cell.velocity}`);
  }
  assertRatchet(cell.ratchet, at);
}

/** The schedule, drift and source, each when present. */
function assertProcesses(config: FigureSequencerConfig): void {
  const cells = config.cells.length;
  config.schedule?.forEach((stage, i) => {
    if (!isIntIn(stage.length, 1, cells) || !isIntIn(stage.bars, 1, FIGURE_SCHEDULE_BARS_MAX)) {
      throw new RangeError(
        `schedule[${i}] must be a length 1..${cells} for 1..${FIGURE_SCHEDULE_BARS_MAX} bars`,
      );
    }
  });
  const { drift, source } = config;
  if (
    drift &&
    !(
      isIntIn(drift.steps, -FIGURE_DRIFT_STEPS_MAX, FIGURE_DRIFT_STEPS_MAX) &&
      isIntIn(drift.everyBars, 1, FIGURE_SCHEDULE_BARS_MAX)
    )
  ) {
    throw new RangeError(
      `drift must be ±${FIGURE_DRIFT_STEPS_MAX} steps every 1..${FIGURE_SCHEDULE_BARS_MAX} bars`,
    );
  }
  if (
    source &&
    !(
      isIntIn(source.slot, 0, MUSIC_SLOT_MAX) &&
      isIntIn(source.offset, -GRID_STEPS_MAX, GRID_STEPS_MAX) &&
      isIntIn(source.transpose, -FIGURE_TRANSPOSE_MAX, FIGURE_TRANSPOSE_MAX)
    )
  ) {
    throw new RangeError(
      `source must be a slot 0..${MUSIC_SLOT_MAX}, an offset within ±${GRID_STEPS_MAX} and a transpose within ±${FIGURE_TRANSPOSE_MAX}`,
    );
  }
}

/** Every constructor and `reconfigure` check; the player runs it inside `plan`. */
export function assertFigureConfig(config: FigureSequencerConfig): void {
  if (!isNoteDivisor(config.divisor)) {
    throw new RangeError(`divisor must divide the bar, got ${config.divisor}`);
  }
  const cells = config.cells.length;
  if (cells < 1 || cells > GRID_STEPS_MAX) {
    throw new RangeError(`cells must hold 1..${GRID_STEPS_MAX} entries, got ${cells}`);
  }
  config.cells.forEach(assertCell);
  if (!isIntIn(config.length, 1, cells)) {
    throw new RangeError(`length must be 1..${cells}, got ${config.length}`);
  }
  if (!(config.gate > 0 && config.gate <= 1)) {
    throw new RangeError(`gate must be in (0, 1], got ${config.gate}`);
  }
  const { octave } = config.register;
  if (!isIntIn(octave, REGISTER_OCTAVE_MIN, REGISTER_OCTAVE_MAX)) {
    throw new RangeError(`register.octave must be ${REGISTER_OCTAVE_MIN}..${REGISTER_OCTAVE_MAX}`);
  }
  for (const key of ['skipChance', 'accentVelocity', 'accentMod'] as const) {
    if (!isUnit(config[key])) throw new RangeError(`${key} must be in [0, 1], got ${config[key]}`);
  }
  if (!Number.isSafeInteger(config.seed)) throw new RangeError('seed must be a safe integer');
  assertStepModLanes(config.lanes);
  assertProcesses(config);
}
