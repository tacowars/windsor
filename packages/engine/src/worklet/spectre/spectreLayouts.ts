/**
 * Every analysis layout Spectre can reach, worked out once
 * (record `2026-10-16-spectre-insert`): for each frame size and overlap, the
 * hop, the frame rate's glide pole and Freeze step, the longest delay a band
 * may take (`maxSeconds`, within the memory) and the frames the sleep waits;
 * for each size, the memory's whole frames; and for each size, overlap and
 * window, the overlap-add gain.
 *
 * A choice changes rarely, so the code that applies one runs too seldom for
 * V8 to optimise, and unoptimised code boxes every double it computes
 * (worklet rule 5). Worked out here, at construction, a change only reads
 * these tables. Pinned by `inserts/spectreAllocation.test.ts`.
 */
import { SPECTRE_DSP, SPECTRE_MOD_TUNING } from '../../inserts/spectreConstants';
import { exp2InPlace } from '../fm/portablePowers';
import type { SpectreWindows } from './spectreWindows';

const SPECTRE_LAYOUT_LOG2_E = 1.4426950408889634;

class SpectreLayouts {
  readonly overlaps: number;
  readonly shapes: number;
  /** By `size · overlaps + overlap`. */
  readonly hops: Int32Array;
  readonly hopSeconds: Float64Array;
  readonly poles: Float64Array;
  readonly freezeSteps: Float64Array;
  readonly reaches: Int32Array;
  readonly quietNeeded: Int32Array;
  /** By size: the memory's whole frames at that size's stride. */
  readonly memoryFrames: Int32Array;
  /** By `(size · overlaps + overlap) · shapes + shape`. */
  readonly gains: Float64Array;

  constructor(
    rate: number,
    sizes: readonly number[],
    factors: readonly number[],
    memory: number,
    windows: SpectreWindows,
  ) {
    const overlaps = factors.length,
      shapes = windows.shapes,
      count = sizes.length * overlaps;
    this.overlaps = overlaps;
    this.shapes = shapes;
    this.hops = new Int32Array(count);
    this.hopSeconds = new Float64Array(count);
    this.poles = new Float64Array(count);
    this.freezeSteps = new Float64Array(count);
    this.reaches = new Int32Array(count);
    this.quietNeeded = new Int32Array(count);
    this.memoryFrames = new Int32Array(sizes.length);
    this.gains = new Float64Array(count * shapes);
    const slot = new Float64Array(1);
    const T = SPECTRE_MOD_TUNING;
    const held = SPECTRE_DSP.scatterFrames + SPECTRE_DSP.smudgeFrames + T.pulseFrames + 1;
    for (let s = 0; s < sizes.length; s++) {
      const size = sizes[s];
      const frames = Math.floor(memory / (size + 2));
      this.memoryFrames[s] = frames;
      for (let o = 0; o < overlaps; o++) {
        const at = s * overlaps + o,
          hop = size / factors[o];
        this.hops[at] = hop;
        this.hopSeconds[at] = hop / rate;
        slot[0] = (-hop / (rate * SPECTRE_DSP.smoothSeconds)) * SPECTRE_LAYOUT_LOG2_E;
        exp2InPlace(slot, 0);
        this.poles[at] = 1 - slot[0];
        this.freezeSteps[at] = hop / (rate * SPECTRE_DSP.freezeSeconds);
        const reach = Math.ceil((SPECTRE_DSP.maxSeconds * rate) / hop);
        this.reaches[at] = reach < frames - 1 ? reach : frames - 1;
        this.quietNeeded[at] = this.reaches[at] + held;
        for (let w = 0; w < shapes; w++)
          this.gains[at * shapes + w] = hop / windows.sums[s * shapes + w];
      }
    }
  }
}

export { SpectreLayouts };
