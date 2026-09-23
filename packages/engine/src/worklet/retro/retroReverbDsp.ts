/** Block-configured vintage reverb. Fixed internal clock; original networks; stereo dry is untouched. */
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

  constructor(rate: number, params: RetroParams) {
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

  convert(value: number): number {
    const bounded = Math.max(-1, Math.min(1, value));
    const quantized = Math.trunc(bounded * C.converterSteps) / C.converterSteps;
    return bounded + this.character * (quantized - bounded);
  }

  internal(input: number): void {
    const delayed =
      this.preDelay < 1 / C.rate ? this.convert(input) : this.pre.read(this.preDelay * C.rate);
    this.pre.write(this.convert(input));
    this.tank.tick(delayed);
    let left = this.tank.left,
      right = this.tank.right;
    // Only finite modes pay for the dense tap field; fades retain it until inaudible.
    if (this.finite > C.silenceFloor) {
      this.reflections.tick(delayed);
      left += this.finite * (this.reflections.left - left);
      right += this.finite * (this.reflections.right - right);
    } else {
      // Keep the finite history current so changing modes never revives stale audio.
      this.reflections.delay.write(delayed);
    }
    this.wetToneLeft += this.wetPole * (left - this.wetToneLeft);
    this.wetToneRight += this.wetPole * (right - this.wetToneRight);
    if (Math.abs(this.wetToneLeft) < C.silenceFloor) this.wetToneLeft = 0;
    if (Math.abs(this.wetToneRight) < C.silenceFloor) this.wetToneRight = 0;
    this.heldLeft = this.convert(this.wetToneLeft);
    this.heldRight = this.convert(this.wetToneRight);
  }

  tick(left: number, right: number): void {
    const input = this.inputFilter.tick((left + right) / 2);
    const step = C.rate / this.rate;
    this.phase += step;
    while (this.phase >= 1) {
      this.phase -= 1;
      const fraction = 1 - this.phase / step;
      this.internal(this.previousInput + fraction * (input - this.previousInput));
    }
    this.previousInput = input;
    const wetL = this.leftFilter.tick(this.heldLeft);
    const wetR = this.rightFilter.tick(this.heldRight);
    this.mix += this.smooth * (this.targetMix - this.mix);
    if (Math.abs(this.targetMix - this.mix) < C.silenceFloor) this.mix = this.targetMix;
    this.left = left + this.mix * (wetL - left);
    this.right = right + this.mix * (wetR - right);
  }
}

export { RetroReverbDsp };
export type { RetroParams };
