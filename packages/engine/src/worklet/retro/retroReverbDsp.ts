/**
 * Block-configured vintage reverb. Fixed internal clock; original networks; stereo dry is untouched.
 * No double crosses a call as an argument or a result: V8 boxes one across a call it does not
 * inline (worklet rule 2). `tick` takes `inputLeft`/`inputRight` and leaves `left`/`right`,
 * `internal` takes `internalInput`, and the converters, networks, lines and filters have fields of
 * their own. Every double field is first written as NaN, then its start value, so none changes
 * representation (rule 7).
 * `inserts/retroReverbAllocation.test.ts` holds it to both on V8.
 *
 * Early reflections (RV-1, `retroEarly.ts`) join the tank's output ahead of the wet tone, scaled by
 * Early times the reverb mode's share, so they fade out with the tank in gated and reverse. At
 * Early 0 the taps do not run and the path is the one without them (`retroReverbNeutralPin.test.ts`).
 *
 * Size (RV-4) is smoothed per block like the others, but never faster than `sizeSlew` a second,
 * and the tank ramps its lines to each block's Size over the internal ticks the block actually runs
 * (`ticks`, counted by `countTicks` from the clock's phase), so a large move sweeps the reads instead of stepping them once a block. A Size that holds still is
 * read as before, to the bit.
 *
 * The converter (RV-6, `retroConverter.ts`) runs at three points: the input, once a tick, and
 * each wet output. `ranging` is the share of the gain-ranging quantiser, smoothed per block like
 * the mode, so a switch crossfades; at exactly 0 the converters take the linear path alone, and
 * a switch away from 0 starts their detectors at unity gain, where ranging is linear to the bit.
 *
 * The on/off switch (windsor#630) is `level`, moved linearly over `INSERT_SWITCH_FADE_S` and landing
 * on its target exactly; the wet share is the smoothed Mix times it, so fully off is the input to
 * the bit. The first quantum that starts fully off clears the networks, lines and filters in place,
 * and while the switch stays off they do not run: the tail is cut, never resumed, and switching back
 * on starts from silence.
 */
import { INSERT_SWITCH_FADE_S } from '../../inserts/insertConstants';
import {
  RETRO_REVERB_DSP as C,
  RETRO_REVERB_BOUNDS as B,
} from '../../inserts/retroReverbConstants';
import { RetroDelay } from './retroDelay';
import { RetroFilter } from './retroFilter';
import { RetroTank } from './retroTank';
import { RetroReflections } from './retroReflections';
import { RetroEarly } from './retroEarly';
import { RetroConverter } from './retroConverter';

type RetroParams = Record<string, Float32Array>;

class RetroReverbDsp {
  tank: RetroTank;
  reflections: RetroReflections;
  earlyTaps: RetroEarly;
  inputConverter: RetroConverter;
  leftConverter: RetroConverter;
  rightConverter: RetroConverter;
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
  /** Internal ticks in the current block, which the tank's Size ramp spans; 0 snaps it. */
  ticks: number;
  decay: number;
  tone: number;
  diffusion: number;
  /** Drift (RV-2), smoothed like the others; a depth within the floor of its target lands on it. */
  driftRate: number;
  driftDepth: number;
  /** Density (RV-3), smoothed like Drift's depth: within the floor of its target it lands on it. */
  density: number;
  /** Low decay and Low cross (RV-5), smoothed; Low decay within the floor of its target lands on it. */
  lowDecay: number;
  lowCross: number;
  preDelay: number;
  character: number;
  /** The gain-ranging converter's share (RV-6): 0 linear, 1 ranging, smoothed per block. */
  ranging: number;
  mix: number;
  targetMix: number;
  /** Early (smoothed), and its level on the wet output: Early times the reverb mode's share. */
  early: number;
  earlyLevel: number;
  /** The switch's fade (0 off, 1 on), its target and its step a sample. */
  level: number;
  targetLevel: number;
  levelStep: number;
  /** Fully off with the networks cleared: `tick` copies the input and runs nothing. */
  dormant: boolean;
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

  constructor(rate: number, params: RetroParams) {
    // Rule 7: each double field is born a double (NaN), before its start value.
    this.rate = this.phase = this.previousInput = this.heldLeft = this.heldRight = NaN;
    this.left = this.right = this.size = this.decay = this.tone = this.diffusion = NaN;
    this.preDelay = this.character = this.mix = this.targetMix = this.duration = NaN;
    this.finite = this.reverse = this.smooth = this.wetToneLeft = this.wetToneRight = NaN;
    this.wetPole = this.inputLeft = this.inputRight = this.internalInput = NaN;
    this.level = this.targetLevel = this.levelStep = this.ranging = NaN;
    this.early = this.earlyLevel = NaN;
    this.driftRate = this.driftDepth = this.density = this.ticks = NaN;
    this.lowDecay = this.lowCross = NaN;
    this.ticks = 0;
    this.inputLeft = this.inputRight = this.internalInput = 0;
    this.rate = rate;
    this.tank = new RetroTank();
    this.reflections = new RetroReflections();
    this.earlyTaps = new RetroEarly(this.reflections.delay);
    this.inputConverter = new RetroConverter();
    this.leftConverter = new RetroConverter();
    this.rightConverter = new RetroConverter();
    this.pre = new RetroDelay(C.rate * B.preDelay[1]);
    this.inputFilter = new RetroFilter(rate);
    this.leftFilter = new RetroFilter(rate);
    this.rightFilter = new RetroFilter(rate);
    this.phase = this.previousInput = this.heldLeft = this.heldRight = this.left = this.right = 0;
    this.size = params.size[0];
    this.decay = params.decay[0];
    this.tone = params.tone[0];
    this.diffusion = params.diffusion[0];
    this.driftRate = params.driftRate[0];
    this.driftDepth = params.driftDepth[0];
    this.density = params.density[0];
    this.lowDecay = params.lowDecay[0];
    this.lowCross = params.lowCross[0];
    this.preDelay = params.preDelay[0];
    this.character = params.character[0];
    this.ranging = params.converter[0] > 0 ? 1 : 0;
    this.duration = params.duration[0];
    this.finite = params.mode[0] > 0 ? 1 : 0;
    this.reverse = params.mode[0] > 1 ? 1 : 0;
    this.early = params.early[0];
    this.earlyLevel = this.early * (1 - this.finite);
    this.mix = this.targetMix = params.mix[0];
    this.level = this.targetLevel = params.enabled[0] ? 1 : 0;
    this.levelStep = 1 / (INSERT_SWITCH_FADE_S * rate);
    this.dormant = false;
    this.smooth = 1 - Math.exp(-1 / (C.smoothSeconds * rate));
    this.wetToneLeft = this.wetToneRight = 0;
    this.wetPole = 1 - Math.exp(-(2 * Math.PI * this.tone) / C.rate);
    this.tank.configure(this);
    this.reflections.configure(this);
    this.earlyTaps.size = this.size;
    this.earlyTaps.configure();
    this.configureConverters();
  }

  configure(params: RetroParams, frames: number): void {
    const k = 1 - Math.exp(-frames / (C.smoothSeconds * this.rate));
    const slew = (C.sizeSlew * frames) / this.rate;
    this.size += Math.max(-slew, Math.min(slew, k * (params.size[0] - this.size)));
    this.decay += k * (params.decay[0] - this.decay);
    this.tone += k * (params.tone[0] - this.tone);
    this.diffusion += k * (params.diffusion[0] - this.diffusion);
    this.driftRate += k * (params.driftRate[0] - this.driftRate);
    this.driftDepth += k * (params.driftDepth[0] - this.driftDepth);
    if (Math.abs(params.driftDepth[0] - this.driftDepth) < C.silenceFloor)
      this.driftDepth = params.driftDepth[0];
    this.density += k * (params.density[0] - this.density);
    if (Math.abs(params.density[0] - this.density) < C.silenceFloor)
      this.density = params.density[0];
    this.lowDecay += k * (params.lowDecay[0] - this.lowDecay);
    if (Math.abs(params.lowDecay[0] - this.lowDecay) < C.silenceFloor)
      this.lowDecay = params.lowDecay[0];
    this.lowCross += k * (params.lowCross[0] - this.lowCross);
    this.preDelay += k * (params.preDelay[0] - this.preDelay);
    this.character += k * (params.character[0] - this.character);
    const ranging = params.converter[0] > 0 ? 1 : 0;
    // From linear: the detectors start at unity gain, where ranging reads as linear.
    if (this.ranging === 0 && ranging !== 0) this.resetConverters();
    this.ranging += k * (ranging - this.ranging);
    if (Math.abs(ranging - this.ranging) < C.silenceFloor) this.ranging = ranging;
    this.duration += k * (params.duration[0] - this.duration);
    this.finite += k * ((params.mode[0] > 0 ? 1 : 0) - this.finite);
    this.reverse += k * ((params.mode[0] > 1 ? 1 : 0) - this.reverse);
    this.early += k * (params.early[0] - this.early);
    if (Math.abs(params.early[0] - this.early) < C.silenceFloor) this.early = params.early[0];
    this.earlyLevel = this.early * (1 - this.finite);
    this.targetMix = params.mix[0];
    this.targetLevel = params.enabled[0] ? 1 : 0;
    if (this.level !== 0) this.dormant = false;
    else if (!this.dormant) this.clear();
    // Back on: the networks run again from the silence `clear` left.
    if (this.targetLevel !== 0) this.dormant = false;
    this.countTicks(frames);
    this.wetPole = 1 - Math.exp(-(2 * Math.PI * this.tone) / C.rate);
    this.tank.configure(this);
    if (this.finite > C.silenceFloor) this.reflections.configure(this);
    if (this.earlyLevel > C.silenceFloor) {
      this.earlyTaps.size = this.size;
      this.earlyTaps.configure();
    }
    this.configureConverters();
  }

  /** The block's Character and converter share, into each conversion point. */
  configureConverters(): void {
    this.inputConverter.character = this.leftConverter.character = this.character;
    this.rightConverter.character = this.character;
    this.inputConverter.ranging = this.leftConverter.ranging = this.ranging;
    this.rightConverter.ranging = this.ranging;
  }

  resetConverters(): void {
    this.inputConverter.reset();
    this.leftConverter.reset();
    this.rightConverter.reset();
  }

  /**
   * `ticks`: the internal ticks the coming block of `frames` runs, counted from `phase` with the
   * same steps `tick` takes (62 or 63 for 128 frames at 48 kHz, not 62.5), and 0 while dormant.
   */
  countTicks(frames: number): void {
    const step = C.rate / this.rate;
    let phase = this.phase,
      ticks = 0;
    for (let i = 0; i < frames; i++) {
      phase += step;
      while (phase >= 1) {
        phase -= 1;
        ticks++;
      }
    }
    this.ticks = this.dormant ? 0 : ticks;
  }

  /** Fully off: every line, network and filter state to zero, so nothing old is heard again. */
  clear(): void {
    const tank = this.tank;
    for (let i = 0; i < tank.lines.length; i++) tank.lines[i].buffer.fill(0);
    for (let i = 0; i < tank.diffusers.length; i++) tank.diffusers[i].buffer.fill(0);
    tank.detuneLeft.buffer.fill(0);
    tank.detuneRight.buffer.fill(0);
    tank.damping.fill(0);
    tank.low.lineStates.fill(0);
    tank.low.stateLeft = tank.low.stateRight = 0;
    tank.values.fill(0);
    tank.left = tank.right = 0;
    this.reflections.delay.buffer.fill(0);
    this.reflections.left = this.reflections.right = 0;
    this.pre.buffer.fill(0);
    this.inputFilter.z.fill(0);
    this.leftFilter.z.fill(0);
    this.rightFilter.z.fill(0);
    this.previousInput = this.heldLeft = this.heldRight = 0;
    this.wetToneLeft = this.wetToneRight = 0;
    this.resetConverters();
    this.dormant = true;
  }

  /** One sample of the internal clock, of `internalInput`. */
  internal(): void {
    const converter = this.inputConverter;
    // Once a tick, so the ranging detector sees each sample once.
    converter.input = this.internalInput;
    converter.tick();
    let delayed: number;
    if (this.preDelay < 1 / C.rate) delayed = converter.output;
    else {
      this.pre.delay = this.preDelay * C.rate;
      this.pre.read();
      delayed = this.pre.output;
    }
    this.pre.input = converter.output;
    this.pre.write();
    this.tank.input = delayed;
    this.tank.tick();
    let left = this.tank.left,
      right = this.tank.right;
    // Early 0 (or a finite mode) skips the taps, so the path is exactly the one without them.
    const early = this.earlyLevel > C.silenceFloor;
    // Read before the finite field's history takes this sample.
    if (early) this.earlyTaps.tick();
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
    if (early) {
      left += this.earlyLevel * this.earlyTaps.left;
      right += this.earlyLevel * this.earlyTaps.right;
    }
    this.wetToneLeft += this.wetPole * (left - this.wetToneLeft);
    this.wetToneRight += this.wetPole * (right - this.wetToneRight);
    if (Math.abs(this.wetToneLeft) < C.silenceFloor) this.wetToneLeft = 0;
    if (Math.abs(this.wetToneRight) < C.silenceFloor) this.wetToneRight = 0;
    this.leftConverter.input = this.wetToneLeft;
    this.leftConverter.tick();
    this.heldLeft = this.leftConverter.output;
    this.rightConverter.input = this.wetToneRight;
    this.rightConverter.tick();
    this.heldRight = this.rightConverter.output;
  }

  /** One host sample: `inputLeft`/`inputRight` in, `left`/`right` out. */
  tick(): void {
    const left = this.inputLeft,
      right = this.inputRight;
    if (this.dormant) {
      this.left = left;
      this.right = right;
      return;
    }
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
    const level = this.level;
    if (level !== this.targetLevel)
      this.level =
        this.targetLevel > level
          ? Math.min(this.targetLevel, level + this.levelStep)
          : Math.max(this.targetLevel, level - this.levelStep);
    const wet = this.mix * this.level;
    this.left = left + wet * (wetL - left);
    this.right = right + wet * (wetR - right);
  }
}

export { RetroReverbDsp };
export type { RetroParams };
