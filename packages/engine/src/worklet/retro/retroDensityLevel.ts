/**
 * Density's loudness match (RV-3): each output's line-end sum's energy in taps (E) at the block's
 * Tone, Size and Decay, read from `RETRO_REVERB_DENSITY_LEVEL`, whose header says what it measures
 * and why it moves. Between the nodes it interpolates trilinearly in the logs of the three, on
 * 1 / E (the tank divides by E), and holds the edge nodes' values outside them. Once a block, and
 * only while Density plays.
 *
 * `point` takes Tone, Size and Decay; `match` leaves 1 / E in `left`/`right`: fields and typed
 * arrays, never arguments or results, which V8 boxes across a call it does not inline (worklet
 * rule 2); every double field is first written as one (rule 7). Pinned through the Density test in
 * `inserts/retroReverbDsp.test.ts` and `retroReverbAllocation.test.ts`.
 */
import { RETRO_REVERB_DENSITY_LEVEL as T } from '../../inserts/retroReverbDensityTables';

class RetroDensityLevel {
  /** The axes' nodes as logs, Tone then Size then Decay, end to end, and where each starts. */
  logs: Float64Array;
  starts: Int32Array;
  counts: Int32Array;
  /** 1 / E per node, Tone-major, then Size, then Decay. */
  inverseLeft: Float64Array;
  inverseRight: Float64Array;
  /** Tone, Size and Decay in; per axis, the node at or below it and the fraction to the next. */
  point: Float64Array;
  below: Int32Array;
  past: Float64Array;
  left: number;
  right: number;

  constructor(table = T) {
    const axes = [table.tone, table.size, table.decay];
    this.logs = Float64Array.from(axes.flat(), Math.log);
    this.counts = Int32Array.from(axes, (axis) => axis.length);
    this.starts = Int32Array.from(axes, (_, i) => axes.slice(0, i).flat().length);
    this.inverseLeft = Float64Array.from(table.left.flat(2), (e) => 1 / e);
    this.inverseRight = Float64Array.from(table.right.flat(2), (e) => 1 / e);
    this.point = new Float64Array(axes.length);
    this.below = new Int32Array(axes.length);
    this.past = new Float64Array(axes.length);
    this.left = this.right = NaN;
    this.left = 1 / table.left[0][0][0];
    this.right = 1 / table.right[0][0][0];
  }

  /** Axis `axis`'s node at or below its point (the last but one at most) and the fraction past it. */
  locate(axis: number): void {
    const start = this.starts[axis];
    const value = Math.log(this.point[axis]);
    let node = 0;
    while (node < this.counts[axis] - 2 && value >= this.logs[start + node + 1]) node++;
    const low = this.logs[start + node];
    const fraction = (value - low) / (this.logs[start + node + 1] - low);
    this.below[axis] = node;
    this.past[axis] = Math.max(0, Math.min(1, fraction));
  }

  match(): void {
    for (let axis = 0; axis < this.point.length; axis++) this.locate(axis);
    const sizes = this.counts[1],
      decays = this.counts[2];
    let left = 0,
      right = 0;
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 2; b++)
        for (let c = 0; c < 2; c++) {
          const weight =
            (a ? this.past[0] : 1 - this.past[0]) *
            (b ? this.past[1] : 1 - this.past[1]) *
            (c ? this.past[2] : 1 - this.past[2]);
          const index =
            ((this.below[0] + a) * sizes + this.below[1] + b) * decays + this.below[2] + c;
          left += weight * this.inverseLeft[index];
          right += weight * this.inverseRight[index];
        }
    this.left = left;
    this.right = right;
  }
}

export { RetroDensityLevel };
