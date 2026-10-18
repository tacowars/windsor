/**
 * The Transient insert's signal path (record `2026-10-18-transient-insert`):
 * the detector's two shapes as one gain on a stereo strip, with no latency
 * and no lookahead (decision 4), so the dry and the gain are the same sample.
 *
 * - **Controls** (decision 6): Attack, Sustain, Output and Mix are
 *   `Float64Array` slots through a one-pole of `smoothMs`, and a block
 *   iterates only the slots that moved, as Advanced Drive's do; a slot within
 *   `settle` of its target lands on it.
 * - **Gain** (decision 3): `gainDb = attack·shapeA + sustain·shapeS`, as
 *   `2^(gainDb · log2(10)/20)` through `exp2InPlace`; Output the same way,
 *   worked out only while it moves.
 * - **Output:** `out = outputGain · (mix · gain · x + (1 − mix) · x)` per
 *   channel. At Attack 0, Sustain 0, Output 0 dB and Mix 1 the gain and the
 *   Output are exactly 1 and the output is the input to the bit (decision 7).
 * - **The switch** (windsor#630): `enabled` moves linearly over
 *   `INSERT_SWITCH_FADE_S` and lands on its target, crossfading the input and
 *   the processed signal. Fully off, the processor copies its input
 *   (`bypassed`) while the controls glide on; switched on from fully off,
 *   the detector restarts from rest.
 * - **Sleep** (decision 8, the compressor's pattern): `drowse`, once a block,
 *   puts it to sleep on a block whose input is within `TRANSIENT_SLEEP.floor`
 *   once the detector's window and followers are all under it too. Asleep,
 *   `restBlock`'s caller plays `outputGain · x` with the controls and the
 *   switch stepping each sample in `glide`'s arithmetic: the gain an awake
 *   insert plays over such a block is exactly 1, so the two agree, and a
 *   loud block wakes it with the detector at rest.
 *
 * Invariants: `tick` and `glide` allocate nothing and take and give samples
 * through fields (worklet rule 2); every double field is born NaN (rule 7).
 * Pinned by `inserts/transientAllocation.test.ts`; the path by
 * `inserts/transientDsp.test.ts`, the sleep by `transientSleep.test.ts`.
 */
import { INSERT_SWITCH_FADE_S } from '../../inserts/insertConstants';
import { TRANSIENT_DSP as C } from '../../inserts/transientConstants';
import { TRANSIENT_PARAMS } from '../../inserts/transientParameters';
import { TRANSIENT_SHIPPED_TIMING, TRANSIENT_TIMINGS } from '../../inserts/transientTables';
import type { TransientTiming } from '../../inserts/transientTables';
import { exp2InPlace } from '../fm/portablePowers';
import { poleOf, TransientDetector } from './transientDetector';

type TransientParams = Record<string, Float32Array>;

/** The smoothed controls' slots, in `TRANSIENT_PARAMS` order. */
const ATTACK = 0;
const SUSTAIN = 1;
const OUTPUT = 2;
const MIX = 3;
const CONTROLS = 4;
const NAMES = TRANSIENT_PARAMS.slice(0, CONTROLS).map((p) => p.name);

class TransientDsp {
  readonly rate: number;
  readonly detector: TransientDetector;
  /** The smoothed controls and their targets, by slot. */
  readonly controls: Float64Array;
  readonly targets: Float64Array;
  /** The slots still gliding this block, the first `activeCount`. */
  readonly activeKeys: Int32Array;
  activeCount: number;
  /** Whether Output glides this block, so its gain is worked out a sample at a time. */
  outputMoving: boolean;
  readonly smooth: number;
  /** The switch's fade: 0 the input, 1 the processed signal; its target and its step. */
  level: number;
  target: number;
  readonly levelStep: number;
  /** Fully off with nothing to fade: the processor copies its input. */
  bypassed: boolean;
  /** Whether it may sleep (`sleep: false` is a test's), and whether it is asleep. */
  readonly sleepEnabled: boolean;
  asleep: boolean;
  /** `exp2InPlace`'s operand and result. */
  readonly scratch: Float64Array;
  outputGain: number;
  /** In: a sample. Out: the sample after the insert, and its shaping in dB. */
  inputLeft: number;
  inputRight: number;
  left: number;
  right: number;
  gainDb: number;

  constructor(
    rate: number,
    params: TransientParams,
    timing: TransientTiming = TRANSIENT_TIMINGS[TRANSIENT_SHIPPED_TIMING],
    sleep = true,
  ) {
    this.rate = this.smooth = this.level = this.target = this.levelStep = NaN;
    this.outputGain = this.inputLeft = this.inputRight = this.left = this.right = NaN;
    this.gainDb = NaN;
    this.rate = rate;
    this.scratch = new Float64Array(1);
    this.detector = new TransientDetector(rate, timing, this.scratch);
    this.smooth = poleOf(C.smoothMs, rate, this.scratch);
    this.levelStep = 1 / (INSERT_SWITCH_FADE_S * rate);
    this.controls = new Float64Array(CONTROLS);
    this.targets = new Float64Array(CONTROLS);
    for (let k = 0; k < CONTROLS; k++) this.controls[k] = params[NAMES[k]][0];
    this.targets.set(this.controls);
    this.activeKeys = new Int32Array(CONTROLS);
    this.activeCount = 0;
    this.outputMoving = false;
    this.inputLeft = this.inputRight = this.left = this.right = this.gainDb = 0;
    this.target = params.enabled[0];
    this.level = this.target;
    this.bypassed = this.level === 0;
    this.sleepEnabled = sleep;
    this.asleep = false;
    this.scratch[0] = this.controls[OUTPUT] * C.dbToLog2;
    exp2InPlace(this.scratch, 0);
    this.outputGain = this.scratch[0];
  }

  /** The quantum's params: each control's target, which slots glide, and the switch. */
  configure(params: TransientParams): void {
    const s = this.controls,
      t = this.targets;
    this.activeCount = 0;
    for (let k = 0; k < CONTROLS; k++) {
      t[k] = params[NAMES[k]][0];
      if (t[k] !== s[k]) this.activeKeys[this.activeCount++] = k;
    }
    this.outputMoving = t[OUTPUT] !== s[OUTPUT];
    const target = params.enabled[0];
    if (this.level === 0 && target !== 0) this.detector.reset();
    this.target = target;
    this.bypassed = this.level === 0 && target === 0;
  }

  /** Once a block: a loud one wakes it; a quiet one puts it to sleep once the detector has settled. */
  drowse(quiet: boolean): void {
    if (!quiet) {
      this.asleep = false;
      return;
    }
    if (this.asleep || !this.sleepEnabled || !this.detector.settled()) return;
    this.detector.reset();
    this.asleep = true;
  }

  /** One sample of the controls' glide, the Output's gain while it moves, and the switch's fade. */
  glide(): void {
    const s = this.controls,
      t = this.targets,
      keys = this.activeKeys,
      a = this.smooth;
    for (let i = 0; i < this.activeCount; i++) {
      const k = keys[i];
      s[k] += a * (t[k] - s[k]);
      if (Math.abs(s[k] - t[k]) < C.settle) s[k] = t[k];
    }
    if (this.outputMoving) {
      this.scratch[0] = s[OUTPUT] * C.dbToLog2;
      exp2InPlace(this.scratch, 0);
      this.outputGain = this.scratch[0];
    }
    const level = this.level,
      target = this.target;
    if (level !== target)
      this.level =
        target > level
          ? Math.min(target, level + this.levelStep)
          : Math.max(target, level - this.levelStep);
  }

  /** `frames` samples of the glide alone: a bypassed block's, whose output is its input. */
  rest(frames: number): void {
    for (let n = 0; n < frames; n++) this.glide();
  }

  /** One awake sample: `inputLeft`/`inputRight` into `left`/`right`, its shaping into `gainDb`. */
  tick(): void {
    this.glide();
    const l = this.inputLeft,
      r = this.inputRight,
      detector = this.detector,
      s = this.controls;
    const al = l < 0 ? -l : l,
      ar = r < 0 ? -r : r;
    detector.level = al > ar ? al : ar;
    detector.step();
    const db = s[ATTACK] * detector.shapeA + s[SUSTAIN] * detector.shapeS;
    this.gainDb = db;
    this.scratch[0] = db * C.dbToLog2;
    exp2InPlace(this.scratch, 0);
    const gain = this.scratch[0],
      mix = s[MIX],
      dry = 1 - mix,
      out = this.outputGain;
    const pl = out * (mix * (gain * l) + dry * l),
      pr = out * (mix * (gain * r) + dry * r);
    const level = this.level;
    if (level === 1) {
      this.left = pl;
      this.right = pr;
    } else {
      this.left = l + level * (pl - l);
      this.right = r + level * (pr - r);
    }
  }

  /** One asleep sample: `tick` with the detector at rest, whose gain is exactly 1. */
  idle(): void {
    this.glide();
    const l = this.inputLeft,
      r = this.inputRight,
      s = this.controls;
    const mix = s[MIX],
      dry = 1 - mix,
      out = this.outputGain;
    const pl = out * (mix * l + dry * l),
      pr = out * (mix * r + dry * r);
    const level = this.level;
    if (level === 1) {
      this.left = pl;
      this.right = pr;
    } else {
      this.left = l + level * (pl - l);
      this.right = r + level * (pr - r);
    }
  }
}

export { TransientDsp };
export type { TransientParams };
