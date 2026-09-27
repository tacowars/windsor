/* eslint-disable no-magic-numbers -- DSP: the quantum of 128, the load sampler's milliseconds per second and the descriptor table are the algorithm; the tunables are reverbConstants.ts (#671) */
/**
 * The plate's entry (#671): `DattorroReverb` -- its parameters, its state, the
 * audio-load sampler (#445), `process`, the sleep (#547) -- and
 * `registerProcessor('dattorro-reverb', ...)`. The delay lines
 * (`delayLines.ts`) and the awake render (`tank.ts`) are functions over this
 * processor, installed on its prototype here, so every method body is the one
 * the hand-written `reverb-processor.js` carried, line for line. Invariants:
 * no allocation in `process` (worklet/CLAUDE.md rule 2); fields declared,
 * never initialised (rule 7). `mixer/reverbGolden.test.ts` pins the render.
 *
 * The topology is Jon Dattorro's 1997 figure 1: a pre-delay, an input
 * bandwidth filter, four cascaded all-pass diffusers, and a figure-of-eight
 * "tank" of two coupled loops, each holding two all-passes, two long delays and
 * a damping filter. Stereo output is taken from fourteen fixed taps inside the
 * tank rather than from its loop signals, which is what gives the late field its
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
 *   4. Two independent excursion phases, wrapped, rather than one accumulator
 *      read at two near-2pi multipliers.
 */

import type { ReportLoadMessage } from '../../synth/workletMessages';
import { _applySize, _makeDelay, _read, _readCubic, _readTap, _write1 } from './delayLines';
import {
  ANTI_DENORMAL,
  INPUT_DELAYS,
  MAX_PRE_DELAY,
  MAX_SIZE,
  MAX_TANK_DIFFUSION,
  LINE_COUNT,
  SLEEP_INPUT_FLOOR,
  SMOOTH_SECONDS,
  TANK_DELAYS,
  TAP_TIME,
} from './reverbConstants';
import { _renderBlock, _writeInput } from './tank';

class DattorroReverb extends AudioWorkletProcessor {
  // Declared, never initialised: the constructor writes each one (worklet/CLAUDE.md
  // rule 7), so no field is emitted as `undefined` before its first number.
  _preDelayLength: number;
  _preDelay: Float32Array;
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
  _dampLp: number[];
  _dampHp: number[];
  _excPhase: number;
  _excPhase2: number;
  _denormal: number;
  _size: number;
  _inputGain: number;
  _sleepEnabled: boolean;
  _settledSkip: boolean;
  _sleepSpan: number;
  _quiet: number;
  _asleep: boolean;
  _stepping: boolean;
  _loadQuanta: number;
  _loadCount: number;
  _loadBusyMs: number;
  _loadPeakMs: number;
  _loadUnderruns: number;
  _loadWallStart: number;
  _loadBudgetMs: number;

  // The delay lines and the awake render, installed on the prototype below.
  declare _makeDelay: typeof _makeDelay;
  declare _applySize: typeof _applySize;
  declare _read: typeof _read;
  declare _write1: typeof _write1;
  declare _readTap: typeof _readTap;
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
      ['size',          1,     0.05, MAX_SIZE],
      ['decay',         0.7,   0,    1],
      ['diffusionTank1', 0.7,  0,    MAX_TANK_DIFFUSION],
      ['diffusionTank2', 0.5,  0,    MAX_TANK_DIFFUSION],
      ['tankLowCut',    20,    10,   1000],
      ['tankHighCut',   8000,  200,  20000],
      ['modRate',       0.5,   0,    8],
      ['modDepth',      0.7,   0,    4],
      ['hold',          0,     0,    1],
      ['wet',           1,     0,    1],
      ['dry',           0,     0,    1],
    ].map(([name, defaultValue, minValue, maxValue]) => ({
      name, defaultValue, minValue, maxValue, automationRate: 'k-rate',
    }));
  }

  constructor(options: AudioWorkletNodeOptions) {
    super(options);

    // Pre-delay is a plain ring, always a full second, rounded up to a whole
    // number of render quanta so a block write never straddles the wrap.
    this._preDelayLength = sampleRate + (128 - (sampleRate % 128));
    this._preDelay = new Float32Array(this._preDelayLength);
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

    INPUT_DELAYS.forEach((seconds) => this._makeDelay(seconds, 1));
    TANK_DELAYS.forEach((seconds) => this._makeDelay(seconds, MAX_SIZE));

    this._tap = new Float32Array(TAP_TIME.length);
    this._tapStep = new Float32Array(TAP_TIME.length);

    this._inputLp = 0;
    this._inputHp = 0;
    this._dampLp = [0, 0];
    this._dampHp = [0, 0];

    this._excPhase = 0;
    this._excPhase2 = 0;
    this._denormal = ANTI_DENORMAL;

    this._size = 1;
    this._inputGain = 1;
    this._applySize(1, true);

    // Sleep (#547): samples of continuous silence in and out, the span that has
    // to exceed, and whether the tank is asleep. `sleep: false` and
    // `settledSkip: false` exist so a test can render the plate without either
    // saving and prove the renders agree; nothing else sets them.
    const opts = (options && options.processorOptions) || {};
    this._sleepEnabled = opts.sleep !== false;
    this._settledSkip = opts.settledSkip !== false;
    this._sleepSpan = Math.ceil((Math.max(...TANK_DELAYS) * MAX_SIZE + MAX_PRE_DELAY) * sampleRate);
    this._quiet = 0;
    this._asleep = false;
    this._stepping = false;

    // Audio-load sampler (#445): identical to fm-processor.js's, off until a
    // `reportLoad` message turns it on. The plate is the other standing
    // processor on the audio thread, so a load figure that omitted it would
    // understate what the music costs.
    this._loadQuanta = 0;
    this._loadCount = 0;
    this._loadBusyMs = 0;
    this._loadPeakMs = 0;
    this._loadUnderruns = 0;
    this._loadWallStart = 0;
    this._loadBudgetMs = (128 / sampleRate) * 1000;
    this.port.onmessage = (e: MessageEvent<ReportLoadMessage | undefined>) => {
      const msg = e.data;
      if (!msg || msg.type !== 'reportLoad') return;
      this._loadQuanta = Math.max(0, msg.quanta | 0);
      this._loadCount = 0;
      this._loadBusyMs = 0;
      this._loadPeakMs = 0;
      this._loadWallStart = Date.now();
    };
  }

  /** One quantum's duty-cycle sample and the once-per-interval post (#445). */
  _sampleLoad(t0: number, t1: number): void {
    const spanMs = t1 - t0;
    this._loadBusyMs += spanMs;
    if (spanMs > this._loadPeakMs) this._loadPeakMs = spanMs;
    // `spanMs - 1` is the provable lower bound on the render's duration; see
    // fm-processor.js `sampleLoad` for why the raw crossing count may not
    // accuse a quantum of missing its deadline.
    if (spanMs - 1 >= this._loadBudgetMs) this._loadUnderruns++;
    if (++this._loadCount < this._loadQuanta) return;
    this.port.postMessage({
      type: 'load',
      busyMs: this._loadBusyMs,
      wallMs: t1 - this._loadWallStart,
      quanta: this._loadCount,
      peakMs: this._loadPeakMs,
      underruns: this._loadUnderruns,
    });
    this._loadCount = 0;
    this._loadBusyMs = 0;
    this._loadPeakMs = 0;
    this._loadWallStart = t1;
  }

  /**
   * Asleep or awake (#547). The asleep quantum stays out of `_renderBlock` on
   * purpose: folded into it, a plate that spent its first seconds asleep left
   * V8 with a tank loop optimised on thin feedback, measured 30 % slower on
   * loud input afterwards (dev machine, docs/research/2026-09-15-547-*).
   */
  _render(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    if (this._asleep && this._renderAsleep(inputs[0] ?? [], outputs[0], parameters)) return true;
    return this._renderBlock(inputs, outputs, parameters);
  }

  /** The sampler wrapper; `_renderBlock` below is the plate itself. */
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    if (this._loadQuanta === 0) return this._render(inputs, outputs, parameters);
    const t0 = Date.now();
    const running = this._render(inputs, outputs, parameters);
    this._sampleLoad(t0, Date.now());
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
   * the filter states, the write heads and the modulation phases go back to where a new
   * processor starts, so the first sound after waking renders exactly as it
   * would from a fresh plate. Allocation-free: `fill` writes in place.
   */
  _sleep(): void {
    for (let line = 0; line < LINE_COUNT; line++) this._buffers[line].fill(0);
    // Write heads too: a read's fractional position is summed against the head,
    // so a head far from 0 rounds its last bit differently from a fresh plate's.
    this._write.fill(0);
    this._preDelay.fill(0);
    this._preDelayWrite = 0;
    this._inputLp = 0;
    this._inputHp = 0;
    this._dampLp[0] = this._dampLp[1] = 0;
    this._dampHp[0] = this._dampHp[1] = 0;
    this._excPhase = 0;
    this._excPhase2 = 0;
    this._denormal = ANTI_DENORMAL;
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
    this._applySize(this._size, true);
    return true;
  }
}

// Prototype methods, exactly as the class declared them in the hand-written file.
DattorroReverb.prototype._makeDelay = _makeDelay;
DattorroReverb.prototype._applySize = _applySize;
DattorroReverb.prototype._read = _read;
DattorroReverb.prototype._write1 = _write1;
DattorroReverb.prototype._readTap = _readTap;
DattorroReverb.prototype._readCubic = _readCubic;
DattorroReverb.prototype._writeInput = _writeInput;
DattorroReverb.prototype._renderBlock = _renderBlock;

registerProcessor('dattorro-reverb', DattorroReverb);

export type { DattorroReverb };
