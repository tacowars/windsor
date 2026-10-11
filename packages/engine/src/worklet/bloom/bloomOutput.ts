/**
 * bloom's output (`BLOOM_OUTPUT`): Amount, Mix and the on/off switch over
 * the sounding bands' voices, which `bloomSynth.ts` sums to stereo through
 * this module's pan (`wetLeft`/`wetRight`, set by the route each sample).
 *
 *   wet  = gain · Amount² · Σ_b pan[b] · voice[b]  (pan 1 on both sides at Spread 0)
 *   out  = in + level · (dry · in + wetGain · wet − in)
 *   dry  = min(1, 2 (1 − Mix)),  wetGain = min(1, 2 Mix)
 *
 * Amount follows a squared law. Mix 50 % is `in + wet`; Mix 0 is the input
 * to the bit. Amount and Mix
 * glide per sample (`smoothSeconds`) from their raw slots. The switch's
 * `level` moves linearly over `INSERT_SWITCH_FADE_S` and lands exactly, so
 * fully off is the input to the bit; the route clears and idles bloom then.
 *
 * Levers (`configure` runs once a block):
 * - Spread (`SLOT_SPREAD`, smoothed, 0..1): bands alternate by index, even
 *   left and odd right, each at equal power: the near side √2 cos β, the far
 *   √2 sin β, β = (1 − Spread)·π/4 (`spreadAngle`), so L² + R² of a band is
 *   the same at every Spread and Spread 1 puts each band on one side alone
 *   (√2, 0). The gains (`panLeft`/`panRight`) are rebuilt in place while
 *   Spread moves. Spread 0 is exactly mono: the synthesis skips the gains, L = R.
 *
 * The wet-path slot (`BLOOM_SLOT`): `split`
 * (`SLOT_SPLIT`, stepped, 0 or 1) glides linearly over `INSERT_FADE_SECONDS`
 * and lands exactly. It takes the internal wet out of `left`/`right`
 * (`wetGain · (1 − split)`) and hands it to the processor's outputs 1 and 2:
 *
 *   send     = gain · Amount² · wet               (`sendLeft`/`sendRight`, after Spread)
 *   sendGain = level · min(1, 2 Mix) · split       (Mix's wet share × switch × split)
 *
 * so `left + child(send) · sendGain` with an identity child is the output
 * without a child, at every point of the crossing. Split 0 leaves `wetGain`'s
 * expression untouched: no child is the output bit for bit.
 *
 * Per sample: `tick` reads `inputLeft`/`inputRight` and `wetLeft`/`wetRight`,
 * and leaves `left`/`right`; `rest` is the same with the layer
 * silent, for the route's sleep. No double crosses a call; every double field
 * is born NaN. Pinned by `inserts/bloomDsp.test.ts` and `bloomGolden.test.ts`.
 */
import { BLOOM_OUTPUT as C } from '../../inserts/bloomOutputConstants';
import { INSERT_FADE_SECONDS, INSERT_SWITCH_FADE_S } from '../../inserts/insertConstants';
import { BLOOM_BANDS } from '../../inserts/bloomBandsConstants';
import { bloomSinVersineInPlace } from './bloomBandsMath';
import { bloomOnePoleStep } from './bloomPortable';
import { SLOT_AMOUNT, SLOT_ENABLED, SLOT_MIX, SLOT_SPLIT, SLOT_SPREAD } from './bloomSlots';

class BloomOutput {
  slots: Float64Array;
  controls: Float64Array;
  /** Amount and Mix, gliding per sample, and the gains they give. */
  amount: number;
  mix: number;
  smoothStep: number;
  wetGain: number;
  dryGain: number;
  /** The switch: 0 off, 1 on, its target and its step a sample. */
  level: number;
  targetLevel: number;
  levelStep: number;
  /** Spread as the pan is set for, and each band's left and right gain. */
  spread: number;
  panLeft: Float64Array;
  panRight: Float64Array;
  scratch: Float64Array;
  /** The slot's split (0..1), its target and its step a sample. */
  split: number;
  targetSplit: number;
  splitStep: number;
  /** The layer's gain before Mix (gain · Amount²) and Mix's wet share. */
  preGain: number;
  postGain: number;
  /** The layer after Amount for the slot's child, and the gain its return takes. */
  sendLeft: number;
  sendRight: number;
  sendGain: number;
  /** The generated layer this sample, before Amount and Mix (the synthesis's). */
  wetLeft: number;
  wetRight: number;
  inputLeft: number;
  inputRight: number;
  left: number;
  right: number;

  constructor(rate: number, slots: Float64Array, controls: Float64Array) {
    this.amount = this.mix = this.smoothStep = this.wetGain = this.dryGain = NaN;
    this.level = this.targetLevel = this.levelStep = this.wetLeft = this.wetRight = NaN;
    this.inputLeft = this.inputRight = this.left = this.right = this.spread = NaN;
    this.split = this.targetSplit = this.splitStep = this.preGain = this.postGain = NaN;
    this.sendLeft = this.sendRight = this.sendGain = NaN;
    this.slots = slots;
    this.controls = controls;
    this.smoothStep = bloomOnePoleStep(rate, C.smoothSeconds);
    this.levelStep = 1 / (INSERT_SWITCH_FADE_S * rate);
    this.splitStep = 1 / (INSERT_FADE_SECONDS * rate);
    this.panLeft = new Float64Array(BLOOM_BANDS.count);
    this.panRight = new Float64Array(BLOOM_BANDS.count);
    this.scratch = new Float64Array(2);
    this.start();
    this.pan();
  }

  /** Every glide at its target: a fresh insert. */
  start(): void {
    this.amount = this.slots[SLOT_AMOUNT];
    this.mix = this.slots[SLOT_MIX];
    this.targetLevel = this.slots[SLOT_ENABLED] > 0 ? 1 : 0;
    this.level = this.targetLevel;
    this.targetSplit = this.slots[SLOT_SPLIT] > 0 ? 1 : 0;
    this.split = this.targetSplit;
    this.gains();
    this.wetLeft = this.wetRight = this.left = this.right = 0;
    this.sendLeft = this.sendRight = this.sendGain = 0;
  }

  /** Once a block: the switch's and the split's targets, and the pan while Spread moves. */
  configure(): void {
    this.targetLevel = this.slots[SLOT_ENABLED] > 0 ? 1 : 0;
    this.targetSplit = this.slots[SLOT_SPLIT] > 0 ? 1 : 0;
    if (this.controls[SLOT_SPREAD] !== this.spread) this.pan();
  }

  /** Each band's pan gains at this block's Spread, in place. */
  pan(): void {
    const spread = this.controls[SLOT_SPREAD],
      scratch = this.scratch;
    this.spread = spread;
    scratch[0] = (1 - spread) * C.spreadAngle;
    bloomSinVersineInPlace(scratch, 0);
    const near = Math.SQRT2 * (1 - scratch[1]),
      far = Math.SQRT2 * scratch[0];
    for (let b = 0; b < BLOOM_BANDS.count; b++) {
      const left = b % 2 === 0;
      this.panLeft[b] = left ? near : far;
      this.panRight[b] = left ? far : near;
    }
  }

  clear(): void {
    this.wetLeft = this.wetRight = this.left = this.right = 0;
    this.sendLeft = this.sendRight = 0;
  }

  /** Mix's two gains and Amount's squared law, from the glides; the internal wet less the split. */
  gains(): void {
    const mix = this.mix;
    this.dryGain = mix < 1 / 2 ? 1 : 2 * (1 - mix);
    this.wetGain = (mix < 1 / 2 ? 2 * mix : 1) * C.gain * this.amount * this.amount;
    // Only while split is off 0, so no child is the output bit for bit.
    if (this.split !== 0) this.wetGain *= 1 - this.split;
    this.preGain = C.gain * this.amount * this.amount;
    this.postGain = mix < 1 / 2 ? 2 * mix : 1;
  }

  /** Amount, Mix and the switch, one sample on. */
  glide(): void {
    const slots = this.slots,
      step = this.smoothStep;
    const amount = slots[SLOT_AMOUNT],
      mix = slots[SLOT_MIX];
    if (this.amount !== amount || this.mix !== mix) {
      this.amount += step * (amount - this.amount);
      if (Math.abs(amount - this.amount) < C.snapFloor) this.amount = amount;
      this.mix += step * (mix - this.mix);
      if (Math.abs(mix - this.mix) < C.snapFloor) this.mix = mix;
      this.gains();
    }
    const level = this.level;
    if (level !== this.targetLevel)
      this.level =
        this.targetLevel > level
          ? Math.min(this.targetLevel, level + this.levelStep)
          : Math.max(this.targetLevel, level - this.levelStep);
    const split = this.split;
    if (split !== this.targetSplit) {
      this.split =
        this.targetSplit > split
          ? Math.min(this.targetSplit, split + this.splitStep)
          : Math.max(this.targetSplit, split - this.splitStep);
      this.gains();
    }
  }

  tick(): void {
    this.glide();
    const l = this.inputLeft,
      r = this.inputRight,
      wet = this.wetGain,
      dry = this.dryGain;
    this.left = l + this.level * (dry * l + wet * this.wetLeft - l);
    this.right = r + this.level * (dry * r + wet * this.wetRight - r);
    const pre = this.preGain;
    this.sendLeft = pre * this.wetLeft;
    this.sendRight = pre * this.wetRight;
    this.sendGain = this.level * this.postGain * this.split;
  }

  /**
   * Asleep: the layer is silent, so the output is the dry share alone. The
   * sends are silent too, but the return keeps its gain, so a child's tail
   * still sounds while bloom sleeps.
   */
  rest(): void {
    this.glide();
    const l = this.inputLeft,
      r = this.inputRight;
    this.left = l + this.level * (this.dryGain * l - l);
    this.right = r + this.level * (this.dryGain * r - r);
    this.sendLeft = this.sendRight = 0;
    this.sendGain = this.level * this.postGain * this.split;
  }
}

export { BloomOutput };
