/** Advanced Drive's sleep (windsor#793), the plate's pattern (`reverb/reverbProcessor.ts`).
 * After each awake block, `watch` counts it quiet when every input sample is
 * within `floor` and the output, as heard and at the graph's
 * wet and dry before the Mix and the switch, is within `outputFloor`; any other
 * block starts the count again. Once the count reaches the hold, the DSP
 * empties its graph and oversamplers (`AdvancedDriveDsp.sleep`) and the drive
 * sleeps: `rest` writes the dry path (the input, under the floor) and keeps the
 * controls, the follower and the LFO moving sample by sample, with no audio DSP. The
 * first block whose input crosses the floor wakes it, and that block renders
 * in full. `floor` is `DRIVE_SLEEP.inputFloor` divided by the worst-case
 * linear gain of the current targets, which `gauge` bounds when they change,
 * so an input the settings would make heard both keeps the drive awake and
 * wakes it (Codex on PR #797); a crushing stage, whose step a bias can put at
 * any input, leaves only exact zeros quiet. Nothing here touches an awake
 * render's bits: `watch` and `gauge` only read.
 * `sleep: false` in the processor's options builds a watcher that never
 * sleeps, so a test can render the drive without it and compare.
 * Booleans and arrays cross these calls, never a double (worklet rule 2), and
 * the count is first written as NaN (rule 7). Pinned by
 * inserts/advancedDriveSleep.test.ts and inserts/advancedDriveAllocation.test.ts.
 */
import {
  DRIVE_DSP as C,
  DRIVE_MATH as M,
  DRIVE_SHAPERS,
} from '../../inserts/advancedDriveConstants';
import { DRIVE_SLEEP as Z } from '../../inserts/advancedDriveSleepConstants';
import type { AdvancedDriveDsp } from './advancedDriveDsp';
import { DRIVE_KEYS, DRIVE_SLOT as S, driveStageSlots } from './driveSlots';
import type { DriveControls, DriveStageSlots } from './driveSlots';
const CRUSH = DRIVE_SHAPERS.indexOf('crush');
/** True when the channel's first `frames` samples are all within the output floor. */
function outputQuiet(channel: Float32Array | undefined, frames: number): boolean {
  if (!channel) return true;
  for (let i = 0; i < frames; i++) {
    const x = channel[i];
    if (x > Z.outputFloor || x < -Z.outputFloor) return false;
  }
  return true;
}
/** One channel of the dry path: the input, or silence where it has none. */
function writeDry(
  out: Float32Array | undefined,
  input: Float32Array | undefined,
  frames: number,
): void {
  if (!out) return;
  const n = input ? (input.length < frames ? input.length : frames) : 0;
  for (let i = 0; i < n; i++) out[i] = input![i];
  for (let i = n; i < frames; i++) out[i] = 0;
}
export class DriveSleep {
  /** False only for a test's render without sleep. */
  readonly enabled: boolean;
  /** Frames the quiet must hold before the drive sleeps. */
  readonly hold: number;
  /** Frames of quiet so far. */
  quiet: number;
  asleep: boolean;
  /** The input floor at the current settings' worst-case gain, by `gauge`. */
  floor: number;
  /** The targets `floor` was gauged from; NaN until the first block. */
  readonly seen: DriveControls;
  readonly stages: DriveStageSlots[];
  constructor(rate: number, enabled: boolean) {
    this.enabled = enabled;
    // Doubles first written as doubles (worklet rule 7).
    this.hold = this.quiet = this.floor = NaN;
    this.hold = Math.ceil(Z.holdSeconds * rate);
    this.quiet = 0;
    this.floor = Z.inputFloor;
    this.asleep = false;
    this.seen = new Float64Array(DRIVE_KEYS.length).fill(NaN);
    this.stages = Array.from({ length: C.stages }, (_, i) => driveStageSlots(i));
  }
  /** True when the channel's first `frames` samples are all within `floor`; no channel is silence. */
  inputQuiet(channel: Float32Array | undefined, frames: number): boolean {
    if (!channel) return true;
    const n = channel.length < frames ? channel.length : frames,
      floor = this.floor;
    for (let i = 0; i < n; i++) {
      const x = channel[i];
      if (x > floor || x < -floor) return false;
    }
    return true;
  }
  /**
   * Once a block, before the render: when the targets have changed, bound the
   * gain from the input to the output and set `floor` under it. A stage is
   * bounded by its filter's resonant peak and peak gain when filtering, its
   * shaper's steepest slope at the most Amount its modulation can reach plus
   * the DC tracker's as much again when shaping, and its Level; the routes by
   * the larger of the serial pair and the sum of all three, which covers each;
   * then the Drive, the tilt and its undo at their steepest, and the Output.
   */
  gauge(t: DriveControls): void {
    if (!this.enabled) return;
    const seen = this.seen;
    let changed = false;
    for (let k = 0; k < seen.length; k++) {
      if (t[k] !== seen[k]) changed = true;
      seen[k] = t[k];
    }
    if (!changed) return;
    let first = 1,
      second = 1,
      sum = 0;
    for (let i = 0; i < this.stages.length; i++) {
      const p = this.stages[i];
      let g = 1;
      if (t[p.enabled] > 0) {
        const q = t[p.resonance];
        if (t[p.filtering] > 0 && q > Math.SQRT1_2) g *= q / Math.sqrt(1 - 1 / (M.four * q * q));
        if (t[p.filtering] > 0 && t[p.peak] > 0) g *= M.decimal ** (t[p.peak] / C.dbDivisor);
        const a = Math.min(
          1,
          Math.max(0, t[p.amount]) + Math.abs(t[p.envAmount]) + Math.abs(t[p.lfoAmount]),
        );
        if (t[p.shaping] > 0 && a > 0)
          g *=
            t[p.shaper] === CRUSH
              ? Infinity
              : 2 * Z.shaperSlope * M.decimal ** ((a * C.driveScale) / 2 / C.dbDivisor) + 1;
        g *= M.decimal ** (t[p.level] / C.dbDivisor);
      }
      if (i === 0) first = g;
      if (i === 1) second = g;
      sum += g;
    }
    const tilt = Math.abs(t[S.tone]) / 2 / C.dbDivisor;
    const gain =
      M.decimal ** ((t[S.drive] + t[S.output]) / C.dbDivisor) *
      M.decimal ** (tilt * (1 + Math.abs(t[S.compensation]))) *
      Math.max(first * Math.max(1, second), sum);
    this.floor = Z.inputFloor / (Z.headroom * Math.max(1, gain));
  }
  /** After an awake block: count it quiet or not, and sleep once the quiet has held. */
  watch(
    left: Float32Array | undefined,
    right: Float32Array | undefined,
    out: Float32Array[],
    frames: number,
    dsp: AdvancedDriveDsp,
  ): void {
    if (!this.enabled) return;
    const graph = dsp.graph,
      floor = Z.outputFloor;
    const quiet =
      this.inputQuiet(left, frames) &&
      this.inputQuiet(right, frames) &&
      outputQuiet(out[0], frames) &&
      outputQuiet(out[1], frames) &&
      Math.abs(graph.left) <= floor &&
      Math.abs(graph.right) <= floor &&
      Math.abs(graph.dryLeft) <= floor &&
      Math.abs(graph.dryRight) <= floor;
    if (!quiet) {
      this.quiet = 0;
      return;
    }
    this.quiet += frames;
    if (this.quiet < this.hold) return;
    dsp.sleep();
    this.quiet = 0;
    this.asleep = true;
  }
  /**
   * One asleep block: the dry path, and the DSP's control-only rest. False when
   * the input has crossed the floor: the drive wakes, and the caller renders
   * the block in full.
   */
  rest(
    left: Float32Array | undefined,
    right: Float32Array | undefined,
    out: Float32Array[],
    frames: number,
    dsp: AdvancedDriveDsp,
  ): boolean {
    if (!this.inputQuiet(left, frames) || !this.inputQuiet(right, frames)) {
      this.asleep = false;
      return false;
    }
    writeDry(out[0], left, frames);
    writeDry(out[1], right, frames);
    dsp.rest(frames);
    return true;
  }
}
