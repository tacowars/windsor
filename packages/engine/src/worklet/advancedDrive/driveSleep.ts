/** Advanced Drive's sleep (windsor#793), the plate's pattern (`reverb/reverbProcessor.ts`).
 * After each awake block, `watch` counts it quiet when every input sample is
 * within `DRIVE_SLEEP.inputFloor` and the output, as heard and at the graph's
 * wet and dry before the Mix and the switch, is within `outputFloor`; any other
 * block starts the count again. Once the count reaches the hold, the DSP
 * empties its graph and oversamplers (`AdvancedDriveDsp.sleep`) and the drive
 * sleeps: `rest` writes the dry path (the input, under the floor) and keeps the
 * controls, the follower and the LFO moving at block rate, with no DSP. The
 * first block whose input crosses the floor wakes it, and that block renders
 * in full. Nothing here touches an awake render's bits: `watch` only reads.
 * `sleep: false` in the processor's options builds a watcher that never
 * sleeps, so a test can render the drive without it and compare.
 * Booleans and arrays cross these calls, never a double (worklet rule 2), and
 * the count is first written as NaN (rule 7). Pinned by
 * inserts/advancedDriveSleep.test.ts and inserts/advancedDriveAllocation.test.ts.
 */
import { DRIVE_SLEEP as Z } from '../../inserts/advancedDriveSleepConstants';
import type { AdvancedDriveDsp } from './advancedDriveDsp';
/** True when the channel's first `frames` samples are all within the input floor; no channel is silence. */
function inputQuiet(channel: Float32Array | undefined, frames: number): boolean {
  if (!channel) return true;
  const n = channel.length < frames ? channel.length : frames;
  for (let i = 0; i < n; i++) {
    const x = channel[i];
    if (x > Z.inputFloor || x < -Z.inputFloor) return false;
  }
  return true;
}
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
  constructor(rate: number, enabled: boolean) {
    this.enabled = enabled;
    // Doubles first written as doubles (worklet rule 7).
    this.hold = this.quiet = NaN;
    this.hold = Math.ceil(Z.holdSeconds * rate);
    this.quiet = 0;
    this.asleep = false;
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
      inputQuiet(left, frames) &&
      inputQuiet(right, frames) &&
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
   * One asleep block: the dry path, and the DSP's block-rate rest. False when
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
    if (!inputQuiet(left, frames) || !inputQuiet(right, frames)) {
      this.asleep = false;
      return false;
    }
    writeDry(out[0], left, frames);
    writeDry(out[1], right, frames);
    dsp.rest(frames);
    return true;
  }
}
