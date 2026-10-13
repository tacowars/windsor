/**
 * The Pump insert's tunables (record `2026-10-13-pump-insert`): a drawn gain
 * envelope that a key signal's onsets retrigger, for sidechain pumping
 * without a compressor. Read by the main thread (spec, card, automation) and
 * by `worklet/pump/`, so it imports nothing.
 */

/** The processor's registered name. */
export const PUMP_NAME = 'pump-insert';

/** Breakpoints a shape may hold, the first at 0 and the last at 1 of the cycle. */
export const PUMP_MAX_POINTS = 16;
export const PUMP_MIN_POINTS = 2;

/** The synced lengths, in the order the card lists them. */
export const PUMP_DIVISIONS = [
  '1/32',
  '1/16T',
  '1/16',
  '1/8T',
  '1/16D',
  '1/8',
  '1/4T',
  '1/8D',
  '1/4',
  '1/4D',
  '1/2',
  '1/1',
] as const;
export type PumpDivision = (typeof PUMP_DIVISIONS)[number];

/** Each synced length in quarter-note beats. */
export const PUMP_DIVISION_BEATS: Readonly<Record<PumpDivision, number>> = {
  '1/32': 1 / 8,
  '1/16T': 1 / 6,
  '1/16': 1 / 4,
  '1/8T': 1 / 3,
  '1/16D': 3 / 8,
  '1/8': 1 / 2,
  '1/4T': 2 / 3,
  '1/8D': 3 / 4,
  '1/4': 1,
  '1/4D': 3 / 2,
  '1/2': 2,
  '1/1': 4,
};

/** The continuous fields: the spec's ranges, the automation rows' and the knobs'. */
export const PUMP_BOUNDS = {
  /** The cycle's length when not synced, in ms. */
  lengthMs: [20, 2000],
  /** 0 leaves the signal alone, 1 plays the drawn shape in full. */
  depth: [0, 1],
  /** 0 needs a 24 dB jump to trigger, 1 a 3 dB jump (`PUMP_DETECTOR`). */
  sensitivity: [0, 1],
  /** The least time between two triggers, in ms. */
  holdMs: [10, 500],
  /** The gain's slew, in ms: what keeps a retrigger or a drawn step from clicking. */
  smoothMs: [0, 10],
} as const;

/** A new Pump's length: a beat, so it pumps once per four-on-the-floor kick. */
export const PUMP_SYNC_DEFAULTS = { sync: true, division: '1/4' as PumpDivision };

export const PUMP_DEFAULTS = {
  lengthMs: 250,
  depth: 1,
  sensitivity: 0.6,
  holdMs: 80,
  smoothMs: 1.5,
};

/** A point's level (linear gain) and its segment's bend. */
export const PUMP_POINT_BOUNDS = {
  at: [0, 1],
  level: [0, 1],
  bend: [-0.95, 0.95],
} as const;

/**
 * A new Pump's shape: straight down on the trigger, a short hold, then a
 * bent recovery that is back at full level a little past half the cycle.
 */
export const DEFAULT_PUMP_POINTS = [
  { at: 0, level: 0.05, bend: 0 },
  { at: 0.05, level: 0.05, bend: 0.6 },
  { at: 0.6, level: 1, bend: 0 },
  { at: 1, level: 1, bend: 0 },
] as const;

/**
 * The onset detector (`worklet/pump/pumpDetector.ts`): a fast peak follower
 * against a slow follower of the fast one. It fires when the fast one stands
 * `riseDb` above the slow one and above the floor, and re-arms when the gap
 * has fallen to `rearmShare` of the rise.
 */
export const PUMP_DETECTOR = {
  fastAttackMs: 0.2,
  fastReleaseMs: 15,
  slowMs: 60,
  /** The rise needed at sensitivity 0 and at 1, in dB. */
  riseAtZeroDb: 24,
  riseAtOneDb: 3,
  rearmShare: 0.5,
  floorDb: -60,
} as const;

export const PUMP_DSP = {
  /** A switch param's value at and above which it reads as on. */
  switchOn: 0.5,
  /** Below this slew time the gain follows the shape sample for sample. */
  smoothFloorMs: 0.05,
  /** The tempo a stage assumes before the registry hands it the song's. */
  defaultBpm: 120,
  /** The scope's bins across one cycle. */
  scopeBins: 96,
  /** How often the open card is told where the cycle is. */
  phaseHz: 30,
  /**
   * The processor's `lengthMs` param range: every synced length from `BPM_MIN`
   * to 300 BPM, the longest being 1/1 at 20 BPM.
   */
  lengthParamMs: [5, 12000],
} as const;
