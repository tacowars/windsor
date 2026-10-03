/**
 * The Figure's config (windsor#484, epic windsor#483; record
 * `2026-10-03-figure-sequencer`): a written line of 1–32 cells over the
 * current chord. A cell names a chord tone (`harmony/figureTones.ts`), an
 * octave, a velocity, accent, slide and ratchet, or is a rest or a tie. On
 * the line sit three optional processes: a length `schedule` (additive
 * growth), a rotation `drift`, and a canon `source` (another Figure part's
 * cells, late and transposed).
 *
 * This file is the field set, its defaults and the check every constructor
 * and live edit runs; the normaliser is `song/figureNormalise.ts`. The
 * performer arrives with windsor#485, the processes with windsor#486 and
 * windsor#487.
 */
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  ARP_GATE_DEFAULT,
  ARP_REGISTER_OCTAVE_DEFAULT,
  FIGURE_DRIFT_STEPS_MAX,
  FIGURE_SCHEDULE_BARS_MAX,
  FIGURE_TONE_MAX,
  FIGURE_TRANSPOSE_MAX,
  GRID_DEFAULT_STEP_COUNT,
  GRID_STEPS_MAX,
  GRID_STEP_OCTAVE_MAX,
  MUSIC_SLOT_MAX,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '../audioConstants';
import { assertRatchet } from './gridSequencer';
import { defaultStepCount } from './meter';
import type { Meter } from './meterTables';
import { DIVISORS, isNoteDivisor } from './scheduler';
import { assertStepModLanes, type StepModLane } from './stepModLanes';

export interface FigureNoteCell {
  readonly kind: 'note';
  /** Index into the chord's stack, ±`FIGURE_TONE_MAX`, wrapping with octave carry. */
  readonly tone: number;
  /** Octaves above the part's register octave, ±`GRID_STEP_OCTAVE_MAX`. */
  readonly octave: number;
  /** Scales the part's velocity, 0–1; absent is 1. */
  readonly velocity?: number;
  readonly accent: boolean;
  readonly slide: boolean;
  /** Hits the cell's roll plays, 1 to `RATCHET_MAX` (windsor#366); absent is one. */
  readonly ratchet?: number;
}

export type FigureCell = { readonly kind: 'rest' } | { readonly kind: 'tie' } | FigureNoteCell;

/** One stage of the length schedule: the first `length` cells, for `bars` bars. */
export interface FigureStage {
  readonly length: number;
  readonly bars: number;
}

/** The rotation drift: every `everyBars` bars the line slips `steps` cells. */
export interface FigureDrift {
  readonly steps: number;
  readonly everyBars: number;
}

/** A canon: the part on `slot`'s cells, `offset` steps late and `transpose` semitones up. */
export interface FigureSource {
  readonly slot: number;
  readonly offset: number;
  readonly transpose: number;
}

export interface FigureSequencerConfig {
  /** Ticks per cell: a note value that divides the whole note. */
  divisor: number;
  /** 1–`GRID_STEPS_MAX` written cells; the line loops over the first `length`. */
  cells: readonly FigureCell[];
  /** The loop length, 1..`cells.length`, as the Grid's. */
  length: number;
  /** A note's length as a fraction of its cell, in (0, 1]. */
  gate: number;
  /** The absolute MIDI octave the key root sits at. */
  register: { octave: number };
  /** Chance a note cell rests instead, drawn from the part's stream. */
  skipChance: number;
  /** The bump an accented cell adds to the part's velocity. */
  accentVelocity: number;
  /** The per-note mod an accented cell sends; a plain cell sends 0. */
  accentMod: number;
  /** Step modulation lanes, one value per cell, as the Grid's. */
  lanes: readonly StepModLane[];
  /** The part's own seed; the stream per region is `hashSeed(seed, regionIndex)`. */
  seed: number;
  /** The length schedule, cycling; absent (or empty) plays every cell of `length`. */
  schedule?: readonly FigureStage[];
  /** The rotation drift; absent is none. */
  drift?: FigureDrift;
  /** The canon source; absent plays the part's own cells. */
  source?: FigureSource;
}

/** The optional keys, which a live edit may add to a Figure that lacks them. */
export const FIGURE_OPTIONAL_KEYS = ['schedule', 'drift', 'source'] as const;

/** A plain note cell: the root at the register octave, full velocity. */
export function figureNoteCell(
  tone = 0,
  over: Partial<Omit<FigureNoteCell, 'kind'>> = {},
): FigureNoteCell {
  return { kind: 'note', tone, octave: 0, accent: false, slide: false, ...over };
}

/** The Glass broken chord the default line cycles: root, third, fifth, third. */
const DEFAULT_TONES: readonly number[] = [0, 1, 2, 1];

/** One bar of sixteenths in the song's meter (16 in 4/4, 14 in 7/8, 24 in 12/8), tones 0, 1, 2, 1. */
export function defaultFigureCells(meter?: Meter): FigureCell[] {
  return Array.from({ length: defaultStepCount(meter, DIVISORS.sixteenth) }, (_, i) =>
    figureNoteCell(DEFAULT_TONES[i % DEFAULT_TONES.length] ?? 0),
  );
}

export const DEFAULT_FIGURE_CONFIG: FigureSequencerConfig = {
  divisor: DIVISORS.sixteenth,
  cells: defaultFigureCells(),
  length: GRID_DEFAULT_STEP_COUNT,
  gate: ARP_GATE_DEFAULT,
  register: { octave: ARP_REGISTER_OCTAVE_DEFAULT },
  skipChance: 0,
  accentVelocity: ACCENT_VELOCITY_DEFAULT,
  accentMod: ACCENT_MOD_DEFAULT,
  lanes: [],
  seed: 0,
};

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
