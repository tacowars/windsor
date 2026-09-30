/** Four lossless all-passes per channel; preallocated state, tested via the shipped bundle.
 * Normalized lattice state keeps changing coefficients passive. Only the feedback
 * path saturates; Mix=0 and settled bypass preserve the original stereo samples.
 *
 * The render allocates nothing (worklet rule 2, windsor#231): samples pass in and
 * out through the `input` and `output` slots, never as arguments or returns, which
 * V8 boxes across a call it does not inline; the controls live in Float64Array
 * slots rather than a record keyed by name; and every double field is first
 * written as a double (NaN), so none changes representation (rule 7). Pinned by
 * inserts/phaserAllocation.test.ts.
 */
import { PHASER_DEFAULTS, PHASER_DSP as C } from '../../inserts/phaserConstants';

type PhaserParams = Record<string, Float32Array>;
/** Every control's name, in slot order. */
const KEYS = Object.keys(PHASER_DEFAULTS) as Array<keyof typeof PHASER_DEFAULTS>;
/** Each control's slot in `controls` and `targets`. */
const SLOT = {
  rate: KEYS.indexOf('rate'),
  center: KEYS.indexOf('center'),
  depth: KEYS.indexOf('depth'),
  feedback: KEYS.indexOf('feedback'),
  feedbackCut: KEYS.indexOf('feedbackCut'),
  stereo: KEYS.indexOf('stereo'),
  envelope: KEYS.indexOf('envelope'),
  bassKeep: KEYS.indexOf('bassKeep'),
  mix: KEYS.indexOf('mix'),
  enabled: KEYS.indexOf('enabled'),
};
const LEFT = 0;
const RIGHT = 1;

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
  /** The smoothed controls, by slot. */
  readonly controls: Float64Array;
  /** The block's targets, by slot. */
  readonly targets: Float64Array;
  /** The sample `tick` reads, left and right. */
  readonly input: Float64Array;
  /** The sample `tick` writes, left and right. */
  readonly output: Float64Array;
  phase: number;
  follower: number;
  feedbackPole: number;
  mix: number;

  constructor(rate: number, params: PhaserParams) {
    // Every double field is first written as a double (rule 7).
    this.rate = this.smooth = this.attack = this.release = this.bassPole = NaN;
    this.phase = this.follower = this.feedbackPole = this.mix = NaN;
    this.rate = rate;
    this.smooth = 1 - Math.exp(-1 / (rate * C.smoothSeconds));
    this.attack = 1 - Math.exp(-1 / (rate * C.attackSeconds));
    this.release = 1 - Math.exp(-1 / (rate * C.releaseSeconds));
    this.bassPole = 1 - Math.exp(-(2 * Math.PI * C.bassHz) / rate);
    this.state = new Float64Array(C.stages * 2);
    this.bass = new Float64Array(2);
    this.feedbackLow = new Float64Array(2);
    this.feedbackOut = new Float64Array(2);
    this.controls = new Float64Array(KEYS.length);
    this.targets = new Float64Array(KEYS.length);
    this.input = new Float64Array(2);
    this.output = new Float64Array(2);
    for (let slot = 0; slot < KEYS.length; slot++) {
      const key = KEYS[slot];
      this.controls[slot] = params[key]?.[0] ?? Number(PHASER_DEFAULTS[key]);
    }
    this.targets.set(this.controls);
    this.phase = this.follower = 0;
    this.feedbackPole = this.mix = 0;
  }

  configure(params: PhaserParams, _frames: number): void {
    const t = this.targets;
    for (let slot = 0; slot < KEYS.length; slot++) t[slot] = params[KEYS[slot]][0];
  }

  /** One stereo sample: `input` in, `output` out. */
  tick(): void {
    const s = this.controls;
    const t = this.targets;
    const k = this.smooth;
    s[SLOT.rate] += k * (t[SLOT.rate] - s[SLOT.rate]);
    s[SLOT.center] += k * (t[SLOT.center] - s[SLOT.center]);
    s[SLOT.depth] += k * (t[SLOT.depth] - s[SLOT.depth]);
    s[SLOT.feedback] += k * (t[SLOT.feedback] - s[SLOT.feedback]);
    s[SLOT.feedbackCut] += k * (t[SLOT.feedbackCut] - s[SLOT.feedbackCut]);
    s[SLOT.stereo] += k * (t[SLOT.stereo] - s[SLOT.stereo]);
    s[SLOT.envelope] += k * (t[SLOT.envelope] - s[SLOT.envelope]);
    s[SLOT.bassKeep] += k * (t[SLOT.bassKeep] - s[SLOT.bassKeep]);
    s[SLOT.mix] += k * (t[SLOT.mix] - s[SLOT.mix]);
    s[SLOT.enabled] += k * (t[SLOT.enabled] - s[SLOT.enabled]);
    const left = this.input[LEFT];
    const right = this.input[RIGHT];
    const level = Math.min(1, Math.max(Math.abs(left), Math.abs(right)) * C.envelopeGain);
    this.follower += (level > this.follower ? this.attack : this.release) * (level - this.follower);
    this.feedbackPole = 1 - Math.exp(-(2 * Math.PI * s[SLOT.feedbackCut]) / this.rate);
    this.mix = s[SLOT.mix] * s[SLOT.enabled];
    this.channel(LEFT);
    this.channel(RIGHT);
    this.phase += s[SLOT.rate] / this.rate;
    this.phase -= Math.floor(this.phase);
  }

  /** One channel of the sample: `input[channel]` in, `output[channel]` out. */
  channel(channel: number): void {
    const s = this.controls;
    const input = this.input[channel];
    const phase = this.phase + (channel * s[SLOT.stereo]) / C.degreesPerTurn;
    // A cosine sweep in octaves: smooth turnarounds, independently adjustable range.
    const octaves =
      -Math.cos(2 * Math.PI * phase) * s[SLOT.depth] + this.follower * s[SLOT.envelope];
    const hz = Math.max(
      C.minHz,
      Math.min(this.rate * C.maxRateRatio, s[SLOT.center] * 2 ** octaves),
    );
    const tangent = Math.tan((Math.PI * hz) / this.rate);
    const a = (tangent - 1) / (tangent + 1);
    const b = Math.sqrt(1 - a * a);
    this.bass[channel] += this.bassPole * (input - this.bass[channel]);
    const dry = input - s[SLOT.bassKeep] * this.bass[channel];
    this.feedbackLow[channel] +=
      this.feedbackPole * (this.feedbackOut[channel] - this.feedbackLow[channel]);
    const feedback = this.feedbackOut[channel] - this.feedbackLow[channel];
    let wet = dry + C.feedbackLimit * Math.tanh((s[SLOT.feedback] * feedback) / C.feedbackLimit);
    for (let stage = 0; stage < C.stages; stage++) {
      const index = channel * C.stages + stage;
      const output = a * wet + b * this.state[index];
      this.state[index] = b * wet - a * this.state[index];
      wet = output;
    }
    this.feedbackOut[channel] = wet;
    this.output[channel] = input + this.mix * (wet - dry);
  }
}

export { PhaserDsp };
export type { PhaserParams };
