/**
 * The Filter insert's signal path (windsor#622): the voice's own filter on a
 * stereo strip. Each channel has one `svfA`, one `svfB` and one `Ladder`,
 * imported from `../fm/` and never copied, so an edit there reaches this
 * bundle in the same `build-worklets` run. Nothing here filters: every
 * filter step is `Svf.process` or `Ladder.process`, every tuning
 * `tuneSvfSections` or `tuneLadder`.
 *
 * - **SVF modes:** `svfA`, then `svfB` at the 24 dB slope, both tuned by
 *   `tuneSvfSections`, as the voice runs them; the Reso is `Svf.q`.
 * - **Acid:** the channel's `Ladder` at the voice's shipped `oversample` and
 *   `steps` (its constructor's), tuned by `tuneLadder` from the Reso.
 * - **Output:** `dry * (1 - mix) + wet * mix`.
 * - **Sweeps:** retuned every `CTRL_INTERVAL` frames along `filterGlide.ts`.
 * - **Changes:** a new mode, or a new slope outside Acid, resets the
 *   incoming path's states with no crossfade; so does turning it back on.
 *   Each reset snaps the next quantum's glide. Off copies the input.
 * - **Rest:** a silent block with every state in use quiet (`Svf.quiet`,
 *   `Ladder.quiet`) writes zeros without running the filters, and zeroes
 *   those states once on the way in.
 *
 * Invariants: the render allocates nothing and no double crosses a call
 * (worklet rule 2): samples pass through the `input` and `output` slots
 * and the ladder's `point`, the glide's values through its fields, and the
 * calls take only objects and small integers; every double field is born
 * NaN (rule 7). Pinned by `inserts/filterAllocation.test.ts`; the paths
 * by `inserts/filterDsp.test.ts` and `filterBundle.test.ts` beside this.
 */
import { FILTER_DSP, FILTER_MODE_VOICE_IDS } from '../../inserts/filterConstants';
import { CTRL_INTERVAL } from '../fm/fmConstants';
import { Ladder } from '../fm/ladder';
import { tuneLadder } from '../fm/ladderTune';
import { FILT_LADDER } from '../fm/modeIds';
import { Svf, tuneSvfSections } from '../fm/svf';
import { FilterGlide, glidePiece, landGlide } from './filterGlide';

type FilterParams = Record<string, Float32Array>;

const CHANNELS = 2;
/** The voice's mode id for each value of the `mode` param. */
const MODE_IDS = Int32Array.from(FILTER_MODE_VOICE_IDS);
const LAST_MODE = MODE_IDS.length - 1;

/** The `mode` param's value as the voice's mode id: the nearest index, held to the list. */
function modeOf(value: number): number {
  const index = Math.round(value);
  if (!(index >= 0)) return MODE_IDS[0];
  return MODE_IDS[index > LAST_MODE ? LAST_MODE : index];
}

class FilterDsp {
  readonly rate: number;
  readonly svfA: Svf[];
  readonly svfB: Svf[];
  readonly ladder: Ladder[];
  readonly glide: FilterGlide;
  /** A block's samples, by channel, in and out. */
  readonly input: Float64Array[];
  readonly output: Float64Array[];
  /** The voice's mode id (`modeIds.ts`), the slope, the switch and the mix. */
  mode: number;
  slope24: boolean;
  enabled: boolean;
  mix: number;
  /** False until a quantum sets the glide's ends: the first after construction or a reset snaps. */
  primed: boolean;
  /** Whether the last block wrote silence without running the filters. */
  resting: boolean;

  constructor(rate: number, params: FilterParams) {
    // Rule 7: each double field is born a double (NaN), before its start value.
    this.rate = this.mix = NaN;
    this.rate = rate;
    this.svfA = [];
    this.svfB = [];
    this.ladder = [];
    this.input = [];
    this.output = [];
    for (let c = 0; c < CHANNELS; c++) {
      this.svfA.push(new Svf());
      this.svfB.push(new Svf());
      this.ladder.push(new Ladder());
      this.input.push(new Float64Array(FILTER_DSP.blockFrames));
      this.output.push(new Float64Array(FILTER_DSP.blockFrames));
    }
    this.glide = new FilterGlide();
    this.mode = modeOf(params.mode[0]);
    this.slope24 = params.slope24[0] >= FILTER_DSP.switchOn;
    this.enabled = params.enabled[0] >= FILTER_DSP.switchOn;
    this.mix = params.mix[0];
    this.primed = false;
    this.resting = false;
  }

  /** The quantum's params: the switch, the path, the glide's new ends and the mix. */
  configure(params: FilterParams): void {
    const enabled = params.enabled[0] >= FILTER_DSP.switchOn;
    const mode = modeOf(params.mode[0]);
    const slope24 = params.slope24[0] >= FILTER_DSP.switchOn;
    const newPath = mode !== this.mode || (slope24 !== this.slope24 && mode !== FILT_LADDER);
    const reenabled = enabled && !this.enabled;
    this.enabled = enabled;
    this.mode = mode;
    this.slope24 = slope24;
    if (newPath || reenabled) {
      this.resetPath();
      this.primed = false;
    }
    const glide = this.glide;
    glide.cutoffTo = params.cutoff[0];
    glide.resonanceTo = params.resonance[0];
    if (!this.primed) {
      landGlide(glide);
      this.primed = true;
    }
    this.mix = params.mix[0];
  }

  /** Every state of the current mode's path from rest; the tuning carries over. */
  resetPath(): void {
    for (let c = 0; c < CHANNELS; c++) {
      if (this.mode === FILT_LADDER) this.ladder[c].reset();
      else {
        this.svfA[c].reset();
        this.svfB[c].reset();
      }
    }
  }

  /** `frames` samples of `input` through the path into `output`. */
  render(frames: number): void {
    const glide = this.glide;
    if (!this.enabled) {
      this.bypass(frames);
      this.resting = false;
    } else if (this.settled(frames)) {
      if (!this.resting) this.resetPath();
      this.silence(frames);
      this.resting = true;
    } else {
      this.resting = false;
      const pieces = Math.ceil(frames / CTRL_INTERVAL);
      const acid = this.mode === FILT_LADDER;
      for (let piece = 0; piece < pieces; piece++) {
        glidePiece(glide, piece, pieces);
        const from = piece * CTRL_INTERVAL;
        const to = from + CTRL_INTERVAL < frames ? from + CTRL_INTERVAL : frames;
        for (let c = 0; c < CHANNELS; c++) {
          if (acid) this.runLadder(c, from, to);
          else this.runSvf(c, from, to);
        }
      }
    }
    landGlide(glide);
  }

  /** Channel `c`'s SVF sections tuned to the glide's piece, then its samples [from, to). */
  runSvf(c: number, from: number, to: number): void {
    const a = this.svfA[c],
      b = this.svfB[c];
    a.cutoffHz = this.glide.cutoff;
    a.q = this.glide.resonance;
    tuneSvfSections(a, b, this.slope24, this.rate);
    const mode = this.mode;
    const slope24 = this.slope24;
    const input = this.input[c],
      output = this.output[c];
    const mix = this.mix;
    const dryGain = 1 - mix;
    for (let s = from; s < to; s++) {
      const dry = input[s];
      let wet = a.process(dry, mode);
      if (slope24) wet = b.process(wet, mode);
      output[s] = dry * dryGain + wet * mix;
    }
  }

  /** Channel `c`'s ladder tuned to the glide's piece, then its samples [from, to) through `point`. */
  runLadder(c: number, from: number, to: number): void {
    const ladder = this.ladder[c];
    ladder.cutoffHz = this.glide.cutoff;
    ladder.resonance = this.glide.resonance;
    tuneLadder(ladder, this.rate);
    const input = this.input[c],
      output = this.output[c];
    const mix = this.mix;
    const dryGain = 1 - mix;
    for (let s = from; s < to; s++) {
      const dry = input[s];
      ladder.point = dry;
      ladder.process();
      output[s] = dry * dryGain + ladder.point * mix;
    }
  }

  /** The block's input is silent and every state the mode uses is quiet. */
  settled(frames: number): boolean {
    const left = this.input[0],
      right = this.input[1];
    for (let s = 0; s < frames; s++) if (left[s] !== 0 || right[s] !== 0) return false;
    for (let c = 0; c < CHANNELS; c++) {
      if (this.mode === FILT_LADDER) {
        if (!Ladder.quiet(this.ladder[c])) return false;
      } else if (!Svf.quiet(this.svfA[c]) || (this.slope24 && !Svf.quiet(this.svfB[c]))) {
        return false;
      }
    }
    return true;
  }

  /** Off: the input, sample for sample. */
  bypass(frames: number): void {
    for (let c = 0; c < CHANNELS; c++) {
      const input = this.input[c],
        output = this.output[c];
      for (let s = 0; s < frames; s++) output[s] = input[s];
    }
  }

  silence(frames: number): void {
    for (let c = 0; c < CHANNELS; c++) this.output[c].fill(0, 0, frames);
  }
}

export { FilterDsp };
export type { FilterParams };
