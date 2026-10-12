/* eslint-disable no-magic-numbers -- DSP: the quantum of 128, the load sampler's milliseconds per second and the descriptor table are the algorithm; the tunables are reverbConstants.ts (#671) */
/**
 * The plate's entry (#671): `DattorroReverb` -- its parameters, its state, the
 * audio-load sampler (#445), `process`, the sleep (#547) -- and
 * `registerProcessor('dattorro-reverb', ...)`. The delay lines
 * (`delayLines.ts`), the input write (`plateInput.ts`) and the awake render
 * (`tank.ts`) are functions over this
 * processor, installed on its prototype here, so every method body is the one
 * the hand-written `reverb-processor.js` carried, line for line, but for the
 * samples that now cross those calls in fields (windsor#227). Invariants: no
 * allocation in `process` (worklet/CLAUDE.md rule 2); fields declared, never
 * initialised, and every double field first written as a double (rule 7).
 * `mixer/reverbGolden.test.ts` pins the render and
 * `mixer/reverbAllocation.test.ts` its allocation on V8.
 *
 * The topology is Jon Dattorro's 1997 figure 1, with its input stage once per
 * input channel (windsor#763): a pre-delay, an input bandwidth filter and four
 * cascaded all-pass diffusers for each of L and R, Windsor's Build delay
 * (windsor#761, `plateBuild.ts`: a line and a tap set per side, so each loop
 * hears its own onset; L's feeds the right loop and R's the left, the half
 * each side's output reads most), and a figure-of-eight "tank" of two coupled loops, each holding
 * two all-passes, two long delays and a damping filter. Stereo output is taken from
 * fixed taps on all eight tank lines (Windsor's own table since windsor#766,
 * `reverbTapTables.ts`) rather than from its loop signals, which is what gives the late field its
 * density without further delay lines.
 *
 *   Dattorro, "Effect Design Part 1: Reverberator and Other Filters", JAES 1997
 *   https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf
 *
 * Derived from khoin/DattorroReverbNode (public domain), rewritten here for
 * four additions the original does not have, each taken from the paper or from
 * ordinary one-pole filter design:
 *
 *   1. SIZE. Every tank delay and output tap is scaled by a continuous factor,
 *      so one instance covers a tight plate through to a cathedral. Buffers are
 *      allocated for MAX_SIZE and read at a scaled offset from the write head,
 *      which is why each line here keeps one pointer, not the original's two.
 *   2. A high-pass beside each damping low-pass, in the tank and on the input.
 *      Dattorro damps only the top; without a matching low cut the tank pumps
 *      and muddies on sustained low material.
 *   3. HOLD. Decay to unity, input muted, tank filters bypassed -- an infinite
 *      freeze of whatever is in the tank.
 *   4. Modulation on all four tank all-passes (windsor#764,
 *      `plateModulation.ts`), each from its own seeded smoothed noise, where
 *      the paper moves two from one sine.
 */

import type { ReportLoadMessage } from '../../synth/workletMessages';
import { LoadSampler } from '../loadSampler';
import { _applySize, _makeDelay, _read, _readCubic, _write1 } from './delayLines';
import {
  ANTI_DENORMAL,
  DECAY_SECONDS,
  INPUT_DELAYS,
  INPUT_DELAYS_RIGHT,
  LOW_CROSS,
  LOW_DECAY,
  MAX_PRE_DELAY,
  MAX_SIZE,
  MAX_TANK_DIFFUSION,
  LINE_COUNT,
  SLEEP_INPUT_FLOOR,
  SMOOTH_SECONDS,
  TANK_DELAYS,
} from './reverbConstants';
import { makeBuild } from './plateBuild';
import { BUILD, BUILD_SPREAD } from './reverbBuildTables';
import { _writeInput } from './plateInput';
import { makeModulation, resetModulation } from './plateModulation';
import { TAP_TIME } from './reverbTapTables';
import { _renderBlock } from './tank';
import { makeGainPoints } from './tankGains';

class DattorroReverb extends AudioWorkletProcessor {
  // Declared, never initialised: the constructor writes each one (worklet/CLAUDE.md
  // rule 7), so no field is emitted as `undefined` before its first number.
  _preDelayLength: number;
  /** The pre-delay rings, one per input channel (windsor#763), read at the one `preDelay`. */
  _preDelay: Float32Array;
  _preDelayRight: Float32Array;
  _preDelayWrite: number;
  _buffers: Float32Array[];
  _write: Int32Array;
  _mask: Int32Array;
  _nominal: Float32Array;
  _length: Float32Array;
  _lengthTarget: Float32Array;
  _lengthStep: Float32Array;
  _tap: Float32Array;
  _tapStep: Float32Array;
  _inputLp: number;
  _inputHp: number;
  /** The right input's low-pass and high-pass states, at the left's coefficients (windsor#763). */
  _inputLpRight: number;
  _inputHpRight: number;
  /** R's four diffuser reads this sample, lines 12..15 (windsor#763). */
  _rightReads: Float64Array;
  _dampLp: Float64Array;
  _dampHp: Float64Array;
  /** The block's one-pole coefficients: input low-pass and high-pass, tank low-pass and high-pass. */
  _poles: Float64Array;
  /** The sample a read leaves and `_write1` stores (`delayLines.ts`). */
  _value: number;
  /** The cubic read's offset: the modulation's excursion. */
  _offset: number;
  /**
   * The tank modulation (windsor#764, `plateModulation.ts`), written by
   * `makeModulation` from the constructor: per point (lines 4, 6, 8, 10),
   * whether it rises to its next knot, its cursor into the draws, where the
   * segment starts, its span, its phase, its width and its phase step; the
   * excursion it gives this sample; the depth in samples now, this block's
   * target and its per-sample step; each tank line's excursion (its mean while
   * the sources move), which `tankGains.ts` cuts its gain for; and the block's speed.
   */
  _modRising!: Int32Array;
  _modCursor!: Int32Array;
  _modFrom!: Float64Array;
  _modSpan!: Float64Array;
  _modPhase!: Float64Array;
  _modWidth!: Float64Array;
  _modDt!: Float64Array;
  _modOffset!: Float64Array;
  _modDepth!: Float64Array;
  _modDepthTarget!: Float64Array;
  _modDepthStep!: Float64Array;
  /** Each tank line's excursion for its gain, lines 4 to 11: 0 but at the moving all-passes. */
  _modExcursion!: Float64Array;
  _modSpeed!: number;
  _denormal: number;
  _size: number;
  _inputGain: number;
  _sleepEnabled: boolean;
  _settledSkip: boolean;
  _sleepSpan: number;
  _quiet: number;
  _asleep: boolean;
  _stepping: boolean;
  /**
   * Written by `makeGainPoints` (`tankGains.ts`) from the constructor, hence
   * the `!`; like every field here, declared and never initialised.
   *
   * Each tank line's gain point (windsor#748, `tankGains.ts`), lines 4 to 11:
   * the gain now, this block's target, and its per-sample step.
   */
  _gain!: Float64Array;
  _gainTarget!: Float64Array;
  _gainStep!: Float64Array;
  /** False until the first block after construction or sleep sets the gains outright. */
  _gainsPrimed!: boolean;
  /** Whether any gain point moves this block. */
  _ramping!: boolean;
  /**
   * An RT60 in seconds on its way through the measured correction
   * (`decayCorrection.ts`): the RT60 asked in, the one the gains are cut from out.
   */
  _rt60!: number;
  /** A table lookup's point in, its cell and its fraction across it out (`decayCorrection.ts`). */
  _cell!: number;
  _cellAt!: number;
  /**
   * The low band (`plateLowBand.ts`): whether it may run at all (`lowBand:
   * false` is a test's), whether it runs this block, whether its lowpasses
   * start from the circulating sample on this sample; per point, the extra
   * low gain now, its target and step, and the lowpass's state; the
   * lowpass's coefficient, and the prewarp's scratch.
   */
  _lowBandEnabled: boolean;
  _band!: boolean;
  _seedBand!: boolean;
  _lowExtra!: Float64Array;
  _lowExtraTarget!: Float64Array;
  _lowExtraStep!: Float64Array;
  _lowState!: Float64Array;
  _cross!: number;
  _tangent!: Float64Array;
  /**
   * Build (`plateBuild.ts`, windsor#761), written by `makeBuild` from the
   * constructor: `build` smoothed per block like Size; the Build lines, their
   * mask and write head; each tap's time in samples and gain, now, this
   * block's target and per-sample step; the direct level's now, target and
   * step; whether the first block has set them, and whether any moves.
   */
  _build: number;
  /** One Build line per input (windsor#763): the left's feeds the left tap set, the right's the right. */
  _buildLine!: Float32Array;
  _buildLineRight!: Float32Array;
  _buildMask!: number;
  _buildWrite!: number;
  _buildTime!: Float64Array;
  _buildTimeTarget!: Float64Array;
  _buildTimeStep!: Float64Array;
  _buildGain!: Float64Array;
  _buildGainTarget!: Float64Array;
  _buildGainStep!: Float64Array;
  _buildDirect!: Float64Array;
  _buildPrimed!: boolean;
  _buildRamping!: boolean;
  _load: LoadSampler;

  // The delay lines and the awake render, installed on the prototype below.
  declare _makeDelay: typeof _makeDelay;
  declare _applySize: typeof _applySize;
  declare _read: typeof _read;
  declare _write1: typeof _write1;
  declare _readCubic: typeof _readCubic;
  declare _writeInput: typeof _writeInput;
  declare _renderBlock: typeof _renderBlock;

  static get parameterDescriptors() {
    // prettier-ignore
    return [
      ['preDelay',      0,     0,    MAX_PRE_DELAY],
      ['inputLowCut',   20,    10,   1000],
      ['inputHighCut',  10000, 200,  20000],
      ['diffusionIn1',  0.75,  0,    1],
      ['diffusionIn2',  0.625, 0,    1],
      ['build',         ...BUILD],
      ['size',          1,     0.05, MAX_SIZE],
      ['decay',         ...DECAY_SECONDS],
      ['lowDecay',      ...LOW_DECAY],
      ['lowCross',      ...LOW_CROSS],
      ['diffusionTank1', 0.7,  0,    MAX_TANK_DIFFUSION],
      ['diffusionTank2', 0.5,  0,    MAX_TANK_DIFFUSION],
      ['tankLowCut',    20,    10,   1000],
      ['tankHighCut',   8000,  200,  20000],
      ['modRate',       3,     0,    8],
      ['modDepth',      0.35,  0,    4],
      ['hold',          0,     0,    1],
      ['wet',           1,     0,    1],
      ['dry',           0,     0,    1],
      ['clear',         0,     0,    1],
    ].map(([name, defaultValue, minValue, maxValue]) => ({
      name, defaultValue, minValue, maxValue, automationRate: 'k-rate',
    }));
  }

  constructor(options: AudioWorkletNodeOptions) {
    super(options);

    // Every double field is first written as a double, NaN, before its
    // starting value (windsor#227). V8 types a field by its first value: a 0 or
    // 1 would make it a small-integer field, and its first fraction would
    // generalise it, deprecating the map and deoptimising the render.
    this._inputLp = this._inputHp = NaN;
    this._inputLpRight = this._inputHpRight = NaN;
    this._size = this._inputGain = this._build = NaN;
    this._value = this._offset = NaN;
    this._cross = this._rt60 = this._cellAt = NaN;

    // Pre-delay is a plain ring per input channel: MAX_PRE_DELAY rounded up to
    // a whole number of render quanta, so a block write never straddles the
    // wrap, and one quantum more, which the block being written takes. Before
    // windsor#763 the ring was a second plus a part quantum, and at 44.1 kHz
    // the read's clamp held the longest pre-delay 68 samples short.
    this._preDelayLength = Math.ceil((MAX_PRE_DELAY * sampleRate) / 128) * 128 + 128;
    this._preDelay = new Float32Array(this._preDelayLength);
    this._preDelayRight = new Float32Array(this._preDelayLength);
    this._preDelayWrite = 0;

    // One pointer per line; reads are computed backwards from it, which is what
    // lets SIZE change the delay lengths without reallocating.
    this._buffers = [];
    this._write = new Int32Array(LINE_COUNT);
    this._mask = new Int32Array(LINE_COUNT);
    this._nominal = new Float32Array(LINE_COUNT);
    this._length = new Float32Array(LINE_COUNT);
    this._lengthTarget = new Float32Array(LINE_COUNT);
    this._lengthStep = new Float32Array(LINE_COUNT);

    // Lines 0..3 the left input's diffusers, 4..11 the tank, 12..15 the
    // right input's diffusers (windsor#763).
    INPUT_DELAYS.forEach((seconds) => this._makeDelay(seconds, 1));
    TANK_DELAYS.forEach((seconds) => this._makeDelay(seconds, MAX_SIZE));
    INPUT_DELAYS_RIGHT.forEach((seconds) => this._makeDelay(seconds, 1));

    this._tap = new Float32Array(TAP_TIME.length);
    this._tapStep = new Float32Array(TAP_TIME.length);

    this._inputLp = 0;
    this._inputHp = 0;
    this._inputLpRight = 0;
    this._inputHpRight = 0;
    this._rightReads = new Float64Array(INPUT_DELAYS_RIGHT.length);
    this._dampLp = new Float64Array(2);
    this._dampHp = new Float64Array(2);
    this._poles = new Float64Array(4);

    this._denormal = ANTI_DENORMAL;
    makeModulation(this);

    this._size = 1;
    this._inputGain = 1;
    this._applySize(true);

    makeGainPoints(this);
    this._build = BUILD[0];
    makeBuild(this);

    // Sleep (#547): samples of continuous silence in and out, the span that has
    // to exceed, and whether the tank is asleep. `sleep: false` and
    // `settledSkip: false` exist so a test can render the plate without either
    // saving and prove the renders agree, and `lowBand: false` (windsor#748)
    // so one can render it with the low band's code out of the path; nothing
    // else sets them.
    const opts = (options && options.processorOptions) || {};
    this._sleepEnabled = opts.sleep !== false;
    this._settledSkip = opts.settledSkip !== false;
    this._lowBandEnabled = opts.lowBand !== false;
    this._sleepSpan = Math.ceil(
      (Math.max(...TANK_DELAYS) * MAX_SIZE + MAX_PRE_DELAY + BUILD_SPREAD) * sampleRate,
    );
    this._quiet = 0;
    this._asleep = false;
    this._stepping = false;

    // Audio-load sampler (#445, `../loadSampler.ts`), off until a `reportLoad`
    // message turns it on. The plate is the other standing processor on the
    // audio thread, so a load figure that omitted it would understate what
    // the music costs.
    this._load = new LoadSampler(sampleRate, this.port);
    this.port.onmessage = (e: MessageEvent<ReportLoadMessage | undefined>) => {
      const msg = e.data;
      if (!msg || msg.type !== 'reportLoad') return;
      this._load.start(msg.quanta);
    };
  }

  /**
   * Asleep or awake (#547). The asleep quantum stays out of `_renderBlock` on
   * purpose: folded into it, a plate that spent its first seconds asleep left
   * V8 with a tank loop optimised on thin feedback, measured 30 % slower on
   * loud input afterwards (dev machine, docs/research/2026-09-15-547-*).
   *
   * `clear` at 1 (windsor#629) empties the tank at the quantum's start and
   * keeps it empty: the Plate insert raises it once its switch has faded the
   * plate out, so switching on again never brings back the old tail. The
   * empty tank is the sleep's, so the plate sleeps while it is unfed.
   */
  _render(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    if (parameters.clear[0] >= 0.5 && !this._asleep) this._sleep();
    if (this._asleep && this._renderAsleep(inputs[0] ?? [], outputs[0], parameters)) return true;
    return this._renderBlock(inputs, outputs, parameters);
  }

  /** The sampler wrapper; `_renderBlock` below is the plate itself. */
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const load = this._load;
    if (load.quanta === 0) return this._render(inputs, outputs, parameters);
    load.begin();
    const running = this._render(inputs, outputs, parameters);
    load.end(128);
    return running;
  }

  /** True when every input sample this quantum is within the sleep floor. */
  _inputQuiet(input: Float32Array[]): boolean {
    for (let c = 0; c < input.length; c++) {
      const channel = input[c];
      for (let i = 0; i < channel.length; i++) {
        if (Math.abs(channel[i]) > SLEEP_INPUT_FLOOR) return false;
      }
    }
    return true;
  }

  /**
   * Empty the tank, once, on the way to sleep: every delay line, the pre-delay,
   * the filter states, the write heads and the modulation's sources and cursors go back to where a new
   * processor starts, so the first sound after waking renders exactly as it
   * would from a fresh plate. Allocation-free: `fill` writes in place.
   */
  _sleep(): void {
    for (let line = 0; line < LINE_COUNT; line++) this._buffers[line].fill(0);
    // Write heads too: a read's fractional position is summed against the head,
    // so a head far from 0 rounds its last bit differently from a fresh plate's.
    this._write.fill(0);
    this._preDelay.fill(0);
    this._preDelayRight.fill(0);
    this._preDelayWrite = 0;
    this._inputLp = 0;
    this._inputHp = 0;
    this._inputLpRight = 0;
    this._inputHpRight = 0;
    this._dampLp[0] = this._dampLp[1] = 0;
    this._dampHp[0] = this._dampHp[1] = 0;
    resetModulation(this);
    this._denormal = ANTI_DENORMAL;
    // An empty tank cannot step, so the next block sets its gains outright.
    this._gainsPrimed = false;
    this._band = false;
    this._lowExtra.fill(0);
    this._lowExtraTarget.fill(0);
    this._lowState.fill(0);
    // The Build lines' contents were written before the silence: empty, and
    // their ramps set outright on waking.
    this._buildLine.fill(0);
    this._buildLineRight.fill(0);
    this._buildWrite = 0;
    this._buildPrimed = false;
    this._quiet = 0;
    this._asleep = true;
  }

  /**
   * One asleep quantum: the dry path only (silence times dry), and the
   * block-rate SIZE smoothing, applied outright because an empty tank cannot
   * zipper. Returns false when the input has moved, and the plate wakes.
   */
  _renderAsleep(
    input: Float32Array[],
    output: Float32Array[],
    parameters: Record<string, Float32Array>,
  ): boolean {
    if (parameters.hold[0] >= 0.5 || !this._inputQuiet(input)) {
      this._asleep = false;
      return false;
    }
    const dry = parameters.dry[0];
    const left = output[0];
    const right = output[1];
    const inLeft = input[0];
    const inRight = input.length >= 2 ? input[1] : inLeft;
    for (let i = 0; i < 128; i++) {
      left[i] = inLeft ? inLeft[i] * dry : 0;
      right[i] = inRight ? inRight[i] * dry : 0;
    }
    const smooth = Math.min(1, 128 / (SMOOTH_SECONDS * sampleRate));
    this._size += smooth * (parameters.size[0] - this._size);
    this._inputGain += smooth * (1 - this._inputGain);
    this._applySize(true);
    return true;
  }
}

// Prototype methods, exactly as the class declared them in the hand-written file.
DattorroReverb.prototype._makeDelay = _makeDelay;
DattorroReverb.prototype._applySize = _applySize;
DattorroReverb.prototype._read = _read;
DattorroReverb.prototype._write1 = _write1;
DattorroReverb.prototype._readCubic = _readCubic;
DattorroReverb.prototype._writeInput = _writeInput;
DattorroReverb.prototype._renderBlock = _renderBlock;

registerProcessor('dattorro-reverb', DattorroReverb);

export type { DattorroReverb };
