/**
 * Block-configured vintage reverb. Fixed internal clock; original networks; stereo dry is untouched.
 * No double crosses a call as an argument or a result: V8 boxes one across a call it does not
 * inline (worklet rule 2). `tick` takes `inputLeft`/`inputRight` and leaves `left`/`right`,
 * `internal` takes `internalInput`, `convert` turns `convertInput` into `converted`, and the
 * networks, lines and filters have fields of their own. Every double field is first written as
 * NaN, then its start value, so none changes representation (rule 7).
 * `inserts/retroReverbAllocation.test.ts` holds it to both on V8.
 */
import {
  RETRO_REVERB_DSP as C,
  RETRO_REVERB_BOUNDS as B,
} from '../../inserts/retroReverbConstants';
import { RetroDelay } from './retroDelay';
import { RetroFilter } from './retroFilter';
import { RetroTank } from './retroTank';
import { RetroReflections } from './retroReflections';

type RetroParams = Record<string, Float32Array>;

class RetroReverbDsp {
  tank: RetroTank;
  reflections: RetroReflections;
  pre: RetroDelay;
  inputFilter: RetroFilter;
  leftFilter: RetroFilter;
  rightFilter: RetroFilter;
  rate: number;
  phase: number;
  previousInput: number;
  heldLeft: number;
  heldRight: number;
  left: number;
  right: number;
  size: number;
  decay: number;
  tone: number;
  diffusion: number;
  preDelay: number;
  character: number;
  mix: number;
  targetMix: number;
  duration: number;
  finite: number;
  reverse: number;
  smooth: number;
  wetToneLeft: number;
  wetToneRight: number;
  wetPole: number;
  inputLeft: number;
  inputRight: number;
  internalInput: number;
  convertInput: number;
  converted: number;

  constructor(rate: number, params: RetroParams) {
    // Rule 7: each double field is born a double (NaN), before its start value.
    this.rate = this.phase = this.previousInput = this.heldLeft = this.heldRight = NaN;
    this.left = this.right = this.size = this.decay = this.tone = this.diffusion = NaN;
    this.preDelay = this.character = this.mix = this.targetMix = this.duration = NaN;
    this.finite = this.reverse = this.smooth = this.wetToneLeft = this.wetToneRight = NaN;
    this.wetPole = this.inputLeft = this.inputRight = this.internalInput = NaN;
    this.convertInput = this.converted = NaN;
    this.inputLeft = this.inputRight = this.internalInput = this.convertInput = this.converted = 0;
    this.rate = rate;
    this.tank = new RetroTank();
    this.reflections = new RetroReflections();
    this.pre = new RetroDelay(C.rate * B.preDelay[1]);
    this.inputFilter = new RetroFilter(rate);
    this.leftFilter = new RetroFilter(rate);
    this.rightFilter = new RetroFilter(rate);
    this.phase = this.previousInput = this.heldLeft = this.heldRight = this.left = this.right = 0;
    this.size = params.size[0];
    this.decay = params.decay[0];
    this.tone = params.tone[0];
    this.diffusion = params.diffusion[0];
    this.preDelay = params.preDelay[0];
    this.character = params.character[0];
    this.duration = params.duration[0];
    this.finite = params.mode[0] > 0 ? 1 : 0;
    this.reverse = params.mode[0] > 1 ? 1 : 0;
    this.mix = this.targetMix = params.enabled[0] ? params.mix[0] : 0;
    this.smooth = 1 - Math.exp(-1 / (C.smoothSeconds * rate));
    this.wetToneLeft = this.wetToneRight = 0;
    this.wetPole = 1 - Math.exp(-(2 * Math.PI * this.tone) / C.rate);
    this.tank.configure(this);
    this.reflections.configure(this);
  }

  configure(params: RetroParams, frames: number): void {
    const k = 1 - Math.exp(-frames / (C.smoothSeconds * this.rate));
    this.size += k * (params.size[0] - this.size);
    this.decay += k * (params.decay[0] - this.decay);
    this.tone += k * (params.tone[0] - this.tone);
    this.diffusion += k * (params.diffusion[0] - this.diffusion);
    this.preDelay += k * (params.preDelay[0] - this.preDelay);
    this.character += k * (params.character[0] - this.character);
    this.duration += k * (params.duration[0] - this.duration);
    this.finite += k * ((params.mode[0] > 0 ? 1 : 0) - this.finite);
    this.reverse += k * ((params.mode[0] > 1 ? 1 : 0) - this.reverse);
    this.targetMix = params.enabled[0] ? params.mix[0] : 0;
    this.wetPole = 1 - Math.exp(-(2 * Math.PI * this.tone) / C.rate);
    this.tank.configure(this);
    if (this.finite > C.silenceFloor) this.reflections.configure(this);
  }

  /** `convertInput` through the converter's clip and quantiser, into `converted`. */
  convert(): void {
    const bounded = Math.max(-1, Math.min(1, this.convertInput));
    const quantized = Math.trunc(bounded * C.converterSteps) / C.converterSteps;
    this.converted = bounded + this.character * (quantized - bounded);
  }

  /** One sample of the internal clock, of `internalInput`. */
  internal(): void {
    const input = this.internalInput;
    let delayed: number;
    if (this.preDelay < 1 / C.rate) {
      this.convertInput = input;
      this.convert();
      delayed = this.converted;
    } else {
      this.pre.delay = this.preDelay * C.rate;
      this.pre.read();
      delayed = this.pre.output;
    }
    this.convertInput = input;
    this.convert();
    this.pre.input = this.converted;
    this.pre.write();
    this.tank.input = delayed;
    this.tank.tick();
    let left = this.tank.left,
      right = this.tank.right;
    // Only finite modes pay for the dense tap field; fades retain it until inaudible.
    if (this.finite > C.silenceFloor) {
      this.reflections.input = delayed;
      this.reflections.tick();
      left += this.finite * (this.reflections.left - left);
      right += this.finite * (this.reflections.right - right);
    } else {
      // Keep the finite history current so changing modes never revives stale audio.
      this.reflections.delay.input = delayed;
      this.reflections.delay.write();
    }
    this.wetToneLeft += this.wetPole * (left - this.wetToneLeft);
    this.wetToneRight += this.wetPole * (right - this.wetToneRight);
    if (Math.abs(this.wetToneLeft) < C.silenceFloor) this.wetToneLeft = 0;
    if (Math.abs(this.wetToneRight) < C.silenceFloor) this.wetToneRight = 0;
    this.convertInput = this.wetToneLeft;
    this.convert();
    this.heldLeft = this.converted;
    this.convertInput = this.wetToneRight;
    this.convert();
    this.heldRight = this.converted;
  }

  /** One host sample: `inputLeft`/`inputRight` in, `left`/`right` out. */
  tick(): void {
    const left = this.inputLeft,
      right = this.inputRight;
    this.inputFilter.input = (left + right) / 2;
    this.inputFilter.tick();
    const input = this.inputFilter.output;
    const step = C.rate / this.rate;
    this.phase += step;
    while (this.phase >= 1) {
      this.phase -= 1;
      const fraction = 1 - this.phase / step;
      this.internalInput = this.previousInput + fraction * (input - this.previousInput);
      this.internal();
    }
    this.previousInput = input;
    this.leftFilter.input = this.heldLeft;
    this.leftFilter.tick();
    const wetL = this.leftFilter.output;
    this.rightFilter.input = this.heldRight;
    this.rightFilter.tick();
    const wetR = this.rightFilter.output;
    this.mix += this.smooth * (this.targetMix - this.mix);
    if (Math.abs(this.targetMix - this.mix) < C.silenceFloor) this.mix = this.targetMix;
    this.left = left + this.mix * (wetL - left);
    this.right = right + this.mix * (wetR - right);
  }
}

export { RetroReverbDsp };
export type { RetroParams };
