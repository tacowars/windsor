/** Four lossless all-passes per channel; preallocated state, tested via the shipped bundle.
 * Normalized lattice state keeps changing coefficients passive. Only the feedback
 * path saturates; Mix=0 and settled bypass preserve the original stereo samples.
 */
import { PHASER_DEFAULTS, PHASER_DSP as C } from '../../inserts/phaserConstants';

type PhaserParams = Record<string, Float32Array>;
const KEYS = Object.keys(PHASER_DEFAULTS) as Array<keyof typeof PHASER_DEFAULTS>;
type Controls = Record<(typeof KEYS)[number], number>;

class PhaserDsp {
  readonly rate: number;
  readonly smooth: number;
  readonly attack: number;
  readonly release: number;
  readonly bassPole: number;
  readonly state: Float64Array;
  readonly bass: Float64Array;
  readonly feedbackLow: Float64Array;
  readonly feedbackOut: Float64Array;
  readonly controls: Controls;
  readonly targets: Controls;
  phase: number;
  follower: number;
  left: number;
  right: number;
  feedbackPole: number;
  mix: number;

  constructor(rate: number, params: PhaserParams) {
    this.rate = rate;
    this.smooth = 1 - Math.exp(-1 / (rate * C.smoothSeconds));
    this.attack = 1 - Math.exp(-1 / (rate * C.attackSeconds));
    this.release = 1 - Math.exp(-1 / (rate * C.releaseSeconds));
    this.bassPole = 1 - Math.exp(-(2 * Math.PI * C.bassHz) / rate);
    this.state = new Float64Array(C.stages * 2);
    this.bass = new Float64Array(2);
    this.feedbackLow = new Float64Array(2);
    this.feedbackOut = new Float64Array(2);
    this.controls = { ...PHASER_DEFAULTS, enabled: Number(PHASER_DEFAULTS.enabled) };
    this.targets = { ...this.controls };
    for (const key of KEYS) this.controls[key] = params[key]?.[0] ?? this.controls[key];
    this.phase = this.follower = this.left = this.right = 0;
    this.feedbackPole = this.mix = 0;
  }

  configure(params: PhaserParams, _frames: number): void {
    for (const key of KEYS) this.targets[key] = params[key][0];
  }

  tick(left: number, right: number): void {
    const s = this.controls;
    const t = this.targets;
    const k = this.smooth;
    // Named fields keep the sample loop monomorphic; configure's dynamic keys are block-rate.
    s.rate += k * (t.rate - s.rate);
    s.center += k * (t.center - s.center);
    s.depth += k * (t.depth - s.depth);
    s.feedback += k * (t.feedback - s.feedback);
    s.feedbackCut += k * (t.feedbackCut - s.feedbackCut);
    s.stereo += k * (t.stereo - s.stereo);
    s.envelope += k * (t.envelope - s.envelope);
    s.bassKeep += k * (t.bassKeep - s.bassKeep);
    s.mix += k * (t.mix - s.mix);
    s.enabled += k * (t.enabled - s.enabled);
    const level = Math.min(1, Math.max(Math.abs(left), Math.abs(right)) * C.envelopeGain);
    this.follower += (level > this.follower ? this.attack : this.release) * (level - this.follower);
    this.feedbackPole = 1 - Math.exp(-(2 * Math.PI * s.feedbackCut) / this.rate);
    this.mix = s.mix * s.enabled;
    this.left = this.channel(left, 0);
    this.right = this.channel(right, 1);
    this.phase += s.rate / this.rate;
    this.phase -= Math.floor(this.phase);
  }

  channel(input: number, channel: number): number {
    const s = this.controls;
    const phase = this.phase + (channel * s.stereo) / C.degreesPerTurn;
    // A cosine sweep in octaves: smooth turnarounds, independently adjustable range.
    const octaves = -Math.cos(2 * Math.PI * phase) * s.depth + this.follower * s.envelope;
    const hz = Math.max(C.minHz, Math.min(this.rate * C.maxRateRatio, s.center * 2 ** octaves));
    const tangent = Math.tan((Math.PI * hz) / this.rate);
    const a = (tangent - 1) / (tangent + 1);
    const b = Math.sqrt(1 - a * a);
    this.bass[channel] += this.bassPole * (input - this.bass[channel]);
    const dry = input - s.bassKeep * this.bass[channel];
    this.feedbackLow[channel] +=
      this.feedbackPole * (this.feedbackOut[channel] - this.feedbackLow[channel]);
    const feedback = this.feedbackOut[channel] - this.feedbackLow[channel];
    let wet = dry + C.feedbackLimit * Math.tanh((s.feedback * feedback) / C.feedbackLimit);
    for (let stage = 0; stage < C.stages; stage++) {
      const index = channel * C.stages + stage;
      const output = a * wet + b * this.state[index];
      this.state[index] = b * wet - a * this.state[index];
      wet = output;
    }
    this.feedbackOut[channel] = wet;
    return input + this.mix * (wet - dry);
  }
}

export { PhaserDsp };
export type { PhaserParams };
