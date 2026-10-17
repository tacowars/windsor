/**
 * The Dub delay's controls (record `2026-10-17-dub-delay-regeneration`): each
 * block's targets, read from the parameters and turned into the forms the
 * loop uses (coefficients, octaves, linear gains), and the per-sample glide of
 * every control toward them. `glide` is the one arithmetic both an awake
 * sample (`DelayDsp.tick`) and an asleep one (`DelayDsp.rest`) step, so a wake
 * finds every control where an awake delay fed silence would hold it.
 *
 * - Continuous controls move on one-pole smoothers (the times on a slower
 *   one, so a time move bends pitch like tape); the switch and sustain move
 *   linearly and land on their targets exactly, so fully off is the input to
 *   the bit.
 * - The loop filter's and the saturation's shapes are choices: a change
 *   crossfades the old shape's output to the new one's over
 *   `INSERT_SWITCH_FADE_S` (`from`, `to` and `fade`), from one shared state,
 *   so nothing in the loop jumps.
 *
 * No double crosses a call (worklet rule 2): conversions read and write the
 * `scratch` slot through `exp2InPlace` and `log2InPlace`, the portable powers,
 * so a golden render is the same bits on every platform. Pinned by
 * inserts/delayAllocation.test.ts and inserts/delayGolden.test.ts.
 */
import { INSERT_SWITCH_FADE_S } from '../../inserts/insertConstants';
import {
  DELAY_DSP as C,
  DELAY_DEFAULTS,
  DELAY_MODE_IDS,
  DELAY_FILTER_IDS,
  DELAY_CHARACTER_IDS,
} from '../../inserts/delayConstants';
import { exp2InPlace, log2InPlace } from '../fm/portablePowers';
import { DELAY_KEYS as KEYS, DELAY_PARAM_KEYS as PARAMS, DELAY_SLOT as S } from './delaySlots';
import type { DelayControls } from './delaySlots';

type DelayParams = Record<string, Float32Array>;

/** −2π · log2(e): a one-pole's exponent per Hz per sample, as a power of two. */
const ONE_POLE_EXPONENT = -(2 * Math.PI * Math.LOG2E);
/** log2(10) / 20: a dB value's power of two. */
const DB_EXPONENT = (Math.LOG2E * Math.LN10) / C.dbDivisor;

class DelayControlState {
  readonly rate: number;
  readonly controls: DelayControls;
  readonly targets: DelayControls;
  /** One double's room for the portable powers. */
  readonly scratch: Float64Array;
  readonly smooth: number;
  readonly timeSmooth: number;
  /** How far the switch, sustain and a shape's crossfade move a sample. */
  readonly switchStep: number;
  readonly sustainStep: number;
  /**
   * The loop filter's shape fading out, the one fading in, and how far in it is; the same for
   * the saturation. The shapes are small integers, always, so they cross a call as they are.
   */
  filterFrom: number;
  filterTo: number;
  filterFade: number;
  characterFrom: number;
  characterTo: number;
  characterFade: number;
  first: boolean;

  constructor(rate: number) {
    // Doubles first written as doubles (worklet rule 7).
    this.rate = this.smooth = this.timeSmooth = this.switchStep = this.sustainStep = NaN;
    this.filterFade = this.characterFade = NaN;
    this.rate = rate;
    this.scratch = new Float64Array(1);
    this.scratch[0] = 1 / (2 * Math.PI * C.smoothSeconds);
    this.poleInPlace(this.scratch, 0);
    this.smooth = this.scratch[0];
    this.scratch[0] = 1 / (2 * Math.PI * C.timeSmoothSeconds);
    this.poleInPlace(this.scratch, 0);
    this.timeSmooth = this.scratch[0];
    this.switchStep = 1 / (INSERT_SWITCH_FADE_S * rate);
    this.sustainStep = 1 / (C.sustainSeconds * rate);
    this.controls = new Float64Array(KEYS.length);
    for (let k = 0; k < PARAMS.length; k++) {
      const key = PARAMS[k];
      this.controls[k] = key in DELAY_DEFAULTS ? Number(DELAY_DEFAULTS[key as 'mix']) : 0;
    }
    this.targets = Float64Array.from(this.controls);
    this.filterFrom = this.filterTo = DELAY_FILTER_IDS.lowpass;
    this.characterFrom = this.characterTo = DELAY_CHARACTER_IDS.warm;
    this.filterFade = this.characterFade = 1;
    this.first = true;
  }

  /** `values[at]`, a corner in Hz, as a one-pole's coefficient 1 − e^(−2π hz / rate), in place. */
  poleInPlace(values: Float64Array, at: number): void {
    values[at] =
      (ONE_POLE_EXPONENT * Math.min(values[at], this.rate * C.cutoffRateRatio)) / this.rate;
    exp2InPlace(values, at);
    values[at] = 1 - values[at];
  }

  /** `values[at]`, in decibels, as a gain, in place. */
  gainInPlace(values: Float64Array, at: number): void {
    values[at] *= DB_EXPONENT;
    exp2InPlace(values, at);
  }

  /** The block's targets from the parameters, in the forms `glide` and the loop read. */
  configure(params: DelayParams): void {
    const t = this.targets;
    for (let k = 0; k < PARAMS.length; k++) t[k] = params[PARAMS[k]][0];
    t[S.ping] = t[S.mode] === DELAY_MODE_IDS['ping-pong'] ? 1 : 0;
    t[S.mid] = t[S.mode] === DELAY_MODE_IDS['mid-side'] ? 1 : 0;
    this.poleInPlace(t, S.lowCut);
    this.poleInPlace(t, S.dampingHz);
    t[S.cutoff] = Math.max(1, t[S.cutoff]);
    log2InPlace(t, S.cutoff);
    this.gainInPlace(t, S.drive);
    t[S.damping] = -t[S.damping];
    this.gainInPlace(t, S.damping);
    this.gainInPlace(t, S.outputDb);
    t[S.modRate] /= this.rate;
    this.choose(t[S.filter] | 0, t[S.character] | 0);
    if (this.first) {
      for (let k = 0; k < KEYS.length; k++) this.controls[k] = t[k];
      this.filterFrom = this.filterTo;
      this.characterFrom = this.characterTo;
      this.filterFade = this.characterFade = 1;
      this.first = false;
    }
  }

  /** Starts a shape's crossfade when its choice (an integer) changed; a change mid-fade starts from the shape fading in. */
  choose(filter: number, character: number): void {
    if (filter !== this.filterTo) {
      this.filterFrom = this.filterTo;
      this.filterTo = filter;
      this.filterFade = 0;
    }
    if (character !== this.characterTo) {
      this.characterFrom = this.characterTo;
      this.characterTo = character;
      this.characterFade = 0;
    }
  }

  /** One sample of every control's move toward its target. */
  glide(): void {
    const s = this.controls;
    const t = this.targets;
    const k = this.smooth;
    s[S.leftMs] += this.timeSmooth * (t[S.leftMs] - s[S.leftMs]);
    s[S.rightMs] += this.timeSmooth * (t[S.rightMs] - s[S.rightMs]);
    for (let slot = S.feedback; slot <= S.outputDb; slot++) s[slot] += k * (t[slot] - s[slot]);
    s[S.ping] += k * (t[S.ping] - s[S.ping]);
    s[S.mid] += k * (t[S.mid] - s[S.mid]);
    // The switch and sustain land on their targets exactly. Written out, not called: a
    // double passed to a call V8 does not inline is a heap number (worklet rule 2).
    const enabled = s[S.enabled];
    s[S.enabled] =
      t[S.enabled] > enabled
        ? Math.min(t[S.enabled], enabled + this.switchStep)
        : Math.max(t[S.enabled], enabled - this.switchStep);
    const sustain = s[S.sustain];
    s[S.sustain] =
      t[S.sustain] > sustain
        ? Math.min(t[S.sustain], sustain + this.sustainStep)
        : Math.max(t[S.sustain], sustain - this.sustainStep);
    if (this.filterFade < 1) this.filterFade = Math.min(1, this.filterFade + this.switchStep);
    if (this.characterFade < 1)
      this.characterFade = Math.min(1, this.characterFade + this.switchStep);
  }
}

export { DelayControlState };
export type { DelayParams };
