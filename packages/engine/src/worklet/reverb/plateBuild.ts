/**
 * The plate's Build (windsor#761): a short multi-tap delay between the input
 * diffusers and the tank, with a tap set per side. Since windsor#763 each
 * input channel's diffused signal is written into its own Build line, and one
 * tap set reads each: the left line's sum feeds the right loop and the right
 * line's the left loop (the half each side's output reads most), and each sum
 * goes to its own side of the wet output directly, at a level that falls as
 * Build rises. So
 * Build 0 is a dense, immediate onset with an early burst ahead of the tail,
 * and Build 1 swells in.
 *
 * This file is the block-rate half. `makeBuild` allocates the lines once, at
 * construction, for the longest tap in either voicing (`BUILD_LINE_SPREAD`,
 * windsor#746) at the running sample rate, so a read never wraps short at
 * any rate. The tap times, gain rows and direct levels are the voicing's
 * (`reverbVoicingTables.ts`), read through the plate's fields. `configureBuild`
 * runs once a block, after the tank has smoothed `build` as it smooths Size
 * (`SMOOTH_SECONDS`): it lands the last block's ramps on their targets and
 * aims each tap's time (in samples), each tap's gain and the direct level
 * at this block's Build, from `reverbBuildTables.ts`, each ramped across the
 * block a sample at a time, so a sweep moves the reads in sub-sample steps.
 * The direct level is its row times `BUILD_DIRECT_TRIM` over the voicing's
 * output trim, since the tank trims the direct sum with the taps'
 * (windsor#766): the burst keeps its gain whatever the taps' trim.
 * The tap reads, their linear interpolation (the tank's own reads') and the
 * sums are written out in the tank's sample loop (`tank.ts`), never called
 * per sample (worklet rule 6).
 *
 * Invariants: nothing allocated after construction, no double across a call
 * (worklet rule 2), and a settled Build moves nothing (every step exactly
 * 0). `mixer/reverbBuild.test.ts` holds the onset and the live moves;
 * `mixer/reverbGolden.test.ts` pins the render.
 */

import { BUILD_STRETCH_MIN, BUILD_TAP_TIME } from './reverbBuildTables';
import type { DattorroReverb } from './reverbProcessor';
import { BUILD_DIRECT_TRIM } from './reverbTapTables';
import { BUILD_LINE_SPREAD } from './reverbVoicingTables';

/** Samples a quantum: each ramp crosses one. */
const QUANTUM = 128;
/** The linear read's reach past its whole sample, and a sample's margin. */
const READ_REACH = 2;
/** The direct level's slots: now, this block's target, its per-sample step. */
const DIRECT_SLOTS = 3;

/**
 * The Build lines and their ramps, from the processor's constructor, after its
 * double fields are first written as NaN (worklet rule 7). The first block
 * sets every ramp outright.
 */
function makeBuild(plate: DattorroReverb): void {
  const capacity = Math.ceil(BUILD_LINE_SPREAD * sampleRate) + READ_REACH;
  const size = 2 ** Math.ceil(Math.log2(capacity));
  plate._buildLine = new Float32Array(size);
  plate._buildLineRight = new Float32Array(size);
  plate._buildMask = size - 1;
  plate._buildWrite = 0;
  plate._buildTime = new Float64Array(BUILD_TAP_TIME.length);
  plate._buildTimeTarget = new Float64Array(BUILD_TAP_TIME.length);
  plate._buildTimeStep = new Float64Array(BUILD_TAP_TIME.length);
  plate._buildGain = new Float64Array(BUILD_TAP_TIME.length);
  plate._buildGainTarget = new Float64Array(BUILD_TAP_TIME.length);
  plate._buildGainStep = new Float64Array(BUILD_TAP_TIME.length);
  plate._buildDirect = new Float64Array(DIRECT_SLOTS);
  plate._buildPrimed = false;
  plate._buildRamping = false;
}

/**
 * This block's tap times, tap gains and direct level, and their per-sample
 * steps, from the smoothed `plate._build`. Gains and the direct level blend
 * linearly between the two rows either side of Build; every time is
 * stretched by the same factor. The first block after construction or sleep
 * lands Build on its parameter and sets them outright: the line is empty, so
 * nothing can step, and a woken plate renders as a fresh one.
 */
function configureBuild(plate: DattorroReverb, parameters: Record<string, Float32Array>): void {
  const immediate = !plate._buildPrimed;
  if (immediate) plate._build = parameters.build[0];
  const build = Math.min(1, Math.max(0, plate._build));
  const stretch = (BUILD_STRETCH_MIN + (1 - BUILD_STRETCH_MIN) * build) * sampleRate;
  // The voicing's table (windsor#746, `plateVoicing.ts`).
  const tapTime = plate._buildTapTime;
  const rows = plate._buildGainRows;
  const directRows = plate._buildDirectRows;
  const position = build * (rows.length - 1);
  const lower = Math.min(Math.floor(position), rows.length - 2);
  const along = position - lower;
  const below = rows[lower];
  const above = rows[lower + 1];
  const time = plate._buildTime;
  const timeTarget = plate._buildTimeTarget;
  const timeStep = plate._buildTimeStep;
  const gain = plate._buildGain;
  const gainTarget = plate._buildGainTarget;
  const gainStep = plate._buildGainStep;
  let ramping = false;
  for (let t = 0; t < time.length; t++) {
    // The last block's ramps end on their targets exactly, not on 128 rounded adds.
    time[t] = timeTarget[t];
    gain[t] = gainTarget[t];
    timeTarget[t] = tapTime[t] * stretch;
    gainTarget[t] = below[t] + (above[t] - below[t]) * along;
    if (immediate) {
      time[t] = timeTarget[t];
      gain[t] = gainTarget[t];
    }
    timeStep[t] = (timeTarget[t] - time[t]) / QUANTUM;
    gainStep[t] = (gainTarget[t] - gain[t]) / QUANTUM;
    if (timeStep[t] !== 0 || gainStep[t] !== 0) ramping = true;
  }
  const direct = plate._buildDirect;
  direct[0] = direct[1];
  // The tank multiplies the direct sum by the voicing's output trim with the
  // taps' (windsor#766), so the row is aimed at BUILD_DIRECT_TRIM over that
  // trim: the direct path's gain is its row's times BUILD_DIRECT_TRIM in
  // either voicing, whatever its taps' trim.
  direct[1] =
    (directRows[lower] + (directRows[lower + 1] - directRows[lower]) * along) *
    (BUILD_DIRECT_TRIM / plate._outputTrim);
  if (immediate) direct[0] = direct[1];
  direct[2] = (direct[1] - direct[0]) / QUANTUM;
  if (direct[2] !== 0) ramping = true;
  plate._buildPrimed = true;
  plate._buildRamping = ramping;
}

export { configureBuild, makeBuild };
