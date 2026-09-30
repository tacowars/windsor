/**
 * The master column's meters (windsor#193; record
 * `2026-09-30-master-column-and-meters`, decisions 4 and 5): every number the
 * bar, its scale, its readout and its ballistics use. The mockup's "Spec for
 * workers" table (`docs/research/2026-09-30-master-output/mockup.html`) gives
 * them; `meterModel.ts` computes with them and `meterBar.ts` draws.
 */
import { PEAK_METER } from '@windsor/engine';
import { OUTPUT_GAUGE_MAX_DB } from './outputStageTables';

/**
 * A bar's width, and the channel it sits in, in CSS pixels. `meterBar.ts`
 * writes them as `--meter-bar-w` and `--meter-ch-w`; the rest of the look
 * (the segments, the hold line, the readout's size) is `console.css`'s.
 */
export const METER_BAR_WIDTH_PX = 10;
export const METER_CHANNEL_WIDTH_PX = 28;

/**
 * The peak scale in dBFS: the engine's peak-meter range, with a height of
 * ((dB − floor) / (ceiling − floor)) ^ `exponent`, so the loud end has room.
 */
export const METER_SCALE = {
  floorDb: PEAK_METER.floorDb,
  ceilingDb: PEAK_METER.ceilingDb,
  exponent: 1.6,
} as const;
export interface MeterScale {
  readonly floorDb: number;
  readonly ceilingDb: number;
  readonly exponent: number;
}

/** The dBFS scale column's ticks, top to bottom. */
export const METER_TICKS_DB: readonly number[] = [6, 0, -6, -12, -18, -24, -36, -48];

/**
 * The colour zones: teal below `amberFromDb`, amber up to `redFromDb`, red
 * above it, in the console's own colours.
 */
export const METER_ZONES = {
  amberFromDb: -12,
  redFromDb: 0,
  teal: 'var(--modulator)',
  amber: 'var(--carrier)',
  red: 'var(--hot)',
} as const;
export interface MeterZones {
  readonly amberFromDb: number;
  readonly redFromDb: number;
  readonly teal: string;
  readonly amber: string;
  readonly red: string;
}

/**
 * The peak bars' ballistics: an instant attack, a fall of `fallDbPerSecond`
 * that stops at `floorDb`, and a held peak kept for `holdSeconds`.
 */
export const METER_BALLISTICS = {
  floorDb: PEAK_METER.floorDb,
  fallDbPerSecond: 24,
  holdSeconds: PEAK_METER.holdSeconds,
} as const;
export interface MeterBallistics {
  readonly floorDb: number;
  readonly fallDbPerSecond: number;
  readonly holdSeconds: number;
}

/**
 * The gain-reduction bar: 0 dB to the output gauge's `maxDb`, filling from
 * the top, falling back to 0 at the peak bars' rate.
 */
export const REDUCTION_SCALE = {
  maxDb: OUTPUT_GAUGE_MAX_DB,
  ticksDb: [0, 3, 6, 9, 12] as readonly number[],
} as const;
export const REDUCTION_BALLISTICS: MeterBallistics = {
  floorDb: 0,
  fallDbPerSecond: METER_BALLISTICS.fallDbPerSecond,
  holdSeconds: METER_BALLISTICS.holdSeconds,
};

/**
 * The hold line's thickness in CSS pixels. `meterBar.ts` sets it on the line,
 * and `meterModel.ts` keeps a full-scale hold that far inside the bar.
 */
export const METER_HOLD_LINE_PX = 2;

/** Amplitude to dB: 20 dB per decade. */
export const AMPLITUDE_DB_PER_DECADE = 20;
export const DECADE = 10;

/** A cover's scale is written to this many decimals: finer than a pixel on any bar. */
export const METER_TRANSFORM_DECIMALS = 4;

/** A readout shows a tenth of a dB; a reduction under `quietDb` reads as none. */
export const METER_READOUT_DECIMALS = 1;
export const REDUCTION_QUIET_DB = 0.05;

/** What a readout shows below the floor, and for a dimmed gauge. */
export const METER_SILENT_TEXT = '−∞';
export const REDUCTION_OFF_TEXT = '—';

/** The gain-reduction bar's name in each gauge (`gaugeFor` in `outputStageModel.ts`). */
export const REDUCTION_NAMES = { reduction: 'GR', over: 'Over', none: 'Off' } as const;

/** Milliseconds per second, for a frame's timestamp. */
export const MS_PER_SECOND = 1000;
