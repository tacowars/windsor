/**
 * The plate's voicings (windsor#746): `plate` and `room`, each a row of data
 * the one tank reads, not a second processor. A row holds both input chains'
 * diffuser lengths and whether they follow Size, Build's tap times, gain rows
 * and direct levels, and the output tap table (times, lines, signed gains)
 * with its trim. Both rows have the same shape, the same counts and the same
 * array kinds, so the sample loop reads either through the same code and a
 * switch changes which numbers it reads, never what it does
 * (`plateVoicing.ts` swaps them at a block boundary, under a duck).
 *
 * The plate voicing keeps windsor#761's Build table (`reverbBuildTables.ts`)
 * and windsor#766's tap table (`reverbTapTables.ts`); its input diffusers are
 * its own, below. The room voicing's tables are `reverbRoomTables.ts`.
 *
 * Import-free of the scope: nothing here reads `sampleRate`. The derived
 * figures at the end (each input line's capacity, the longest input chain,
 * the longest Build tap) are read by the allocation and the sleep span, so a
 * buffer is sized for whichever voicing needs more, and every reader takes
 * them from here, never from one voicing's table.
 * `__fixtures__/reverbHarness.ts` reads VOICING_ROWS, BUILD_LINE_SPREAD and
 * INPUT_SPAN by their top-level names; `mixer/reverbVoicing.test.ts` holds
 * the rows' shapes.
 */

import { MAX_SIZE } from './reverbConstants';
import { BUILD_DIRECT_ROWS, BUILD_GAIN_ROWS, BUILD_TAP_TIME } from './reverbBuildTables';
import {
  ROOM_BUILD_DIRECT_ROWS,
  ROOM_BUILD_GAIN_ROWS,
  ROOM_BUILD_TAP_TIME,
  ROOM_INPUT_DELAYS,
  ROOM_INPUT_DELAYS_RIGHT,
  ROOM_OUTPUT_TRIM,
  ROOM_TAP_GAIN,
  ROOM_TAP_LINE,
  ROOM_TAP_TIME,
} from './reverbRoomTables';
import { OUTPUT_TRIM, TAP_GAIN, TAP_LINE, TAP_TIME } from './reverbTapTables';

/**
 * The plate voicing's diffusers, seconds, L's (lines 0..3) and R's (lines
 * 12..15): 0.33 to 0.80 ms, fixed whatever the Size, so the onset is instant
 * and dense (against 3.6 to 12.7 ms before windsor#746). Windsor's own,
 * chosen by measurement (`docs/research/2026-10-12-plate-room-voicing/`,
 * `plateSearch.mjs`): of 600 sets drawn between 0.25 and 1.5 ms, each R its L
 * counterpart off by 3 to 15 % as windsor#763 drew its right chain, the ones
 * that keep windsor#763's side leads and its mirror at Size 0.25 and 1 with
 * 0.05 dB to spare at 48 and 44.1 kHz, and the held sine's beat under
 * −18.5 dB, were four; this is the one with the most to spare (0.14 dB). No
 * set under 2 ms keeps the mirror at Size 4, where #766's early taps, no
 * longer smeared, set it (record `2026-10-12-plate-room-voicing`).
 */
const PLATE_INPUT_DELAYS = [0.000383, 0.000533, 0.00065, 0.000804];
const PLATE_INPUT_DELAYS_RIGHT = [0.000331, 0.000498, 0.00058, 0.000747];

/** The `voicing` parameter at or above which the room voicing plays: 0 is plate, 1 is room. */
const VOICING_ROOM_AT = 0.5;

/** One voicing's tables, as the tank reads them: typed, so both rows have one element kind. */
interface VoicingRow {
  /** L's diffusers then R's, seconds (at Size 1 where they follow Size). */
  inputDelays: Float64Array;
  inputFollowsSize: boolean;
  /** Build: tap times at Build 1 (seconds), the gain rows at Build 0, 0.5 and 1, the direct levels. */
  buildTapTime: Float64Array;
  buildGainRows: Float64Array[];
  buildDirectRows: Float64Array;
  /** The output taps: seconds at Size 1, tank lines, signed gains; and the trim on their sum. */
  tapTime: Float64Array;
  tapLine: Int32Array;
  tapGain: Float64Array;
  outputTrim: number;
}

/** The rows, by the `voicing` parameter's value: 0 plate, 1 room. */
const VOICING_ROWS: VoicingRow[] = [
  {
    inputDelays: Float64Array.from([...PLATE_INPUT_DELAYS, ...PLATE_INPUT_DELAYS_RIGHT]),
    inputFollowsSize: false,
    buildTapTime: Float64Array.from(BUILD_TAP_TIME),
    buildGainRows: BUILD_GAIN_ROWS.map((row) => Float64Array.from(row)),
    buildDirectRows: Float64Array.from(BUILD_DIRECT_ROWS),
    tapTime: Float64Array.from(TAP_TIME),
    tapLine: Int32Array.from(TAP_LINE),
    tapGain: Float64Array.from(TAP_GAIN),
    outputTrim: OUTPUT_TRIM,
  },
  {
    inputDelays: Float64Array.from([...ROOM_INPUT_DELAYS, ...ROOM_INPUT_DELAYS_RIGHT]),
    inputFollowsSize: true,
    buildTapTime: Float64Array.from(ROOM_BUILD_TAP_TIME),
    buildGainRows: ROOM_BUILD_GAIN_ROWS.map((row) => Float64Array.from(row)),
    buildDirectRows: Float64Array.from(ROOM_BUILD_DIRECT_ROWS),
    tapTime: Float64Array.from(ROOM_TAP_TIME),
    tapLine: Int32Array.from(ROOM_TAP_LINE),
    tapGain: Float64Array.from(ROOM_TAP_GAIN),
    outputTrim: ROOM_OUTPUT_TRIM,
  },
];

/**
 * A diffuser's longest length in a voicing, seconds: at Size's top where it
 * follows Size, which it does as Size's square root (`_applySize`,
 * `delayLines.ts`, writes the same law).
 */
const reach = (row: VoicingRow, k: number): number =>
  row.inputDelays[k] * (row.inputFollowsSize ? Math.sqrt(MAX_SIZE) : 1);

/** Each input line's capacity in seconds, L's four then R's: the longer voicing's at its longest. */
const INPUT_CAPACITY = Array.from(
  { length: PLATE_INPUT_DELAYS.length + PLATE_INPUT_DELAYS_RIGHT.length },
  (_, k) => Math.max(...VOICING_ROWS.map((row) => reach(row, k))),
);

/** One chain's four diffusers at their longest, seconds: `from` 0 is L's, 4 R's. */
const chainReach = (row: VoicingRow, from: number): number => {
  let sum = 0;
  for (let k = from; k < from + PLATE_INPUT_DELAYS.length; k++) sum += reach(row, k);
  return sum;
};

/**
 * The longest a sample can spend in either input chain, seconds: the four
 * diffusers of the longer chain at their longest, in any voicing. The sleep
 * span counts it, as it counts the longest pre-delay and Build tap.
 */
const INPUT_SPAN = Math.max(
  ...VOICING_ROWS.map((row) =>
    Math.max(chainReach(row, 0), chainReach(row, PLATE_INPUT_DELAYS.length)),
  ),
);

/** Build's longest tap in either voicing, seconds: what the Build lines and the sleep span hold. */
const BUILD_LINE_SPREAD = Math.max(...VOICING_ROWS.flatMap((row) => [...row.buildTapTime]));

export type { VoicingRow };
export {
  PLATE_INPUT_DELAYS,
  PLATE_INPUT_DELAYS_RIGHT,
  VOICING_ROOM_AT,
  VOICING_ROWS,
  INPUT_CAPACITY,
  INPUT_SPAN,
  BUILD_LINE_SPREAD,
};
