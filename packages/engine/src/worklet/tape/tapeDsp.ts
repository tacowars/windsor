/** Stereo REELS Lite adaptation. All state preallocated; seeded renders exercise the shipped processor.
 * Saturation polynomial/makeup from ELPHNT's CC0 tape_core.gendsp. Max noise/filter primitives are adapted.
 */
import {
  TAPE_BOUNDS,
  TAPE_DEFAULTS,
  TAPE_DSP as C,
  TAPE_MODELS,
} from '../../inserts/tapeConstants';
import { TapeTone } from './tapeFilter';
import { TapeMotion } from './tapeMotion';
type TapeParams = Record<string, Float32Array>;
const KEYS = Object.keys(TAPE_DEFAULTS) as Array<keyof typeof TAPE_DEFAULTS>;
type Controls = Record<(typeof KEYS)[number], number>;
class TapeDsp {
  controls: Controls;
  targets: Controls;
  tones: TapeTone[];
  noiseTones: TapeTone[];
  weights: Float64Array;
  noiseOffsets: Float64Array;
  lastDrive = NaN;
  lastTrim = NaN;
  lastHiss = NaN;
  hissGain = 0;
  buffers: Float32Array[];
  dcInput = new Float64Array(2);
  dcOutput = new Float64Array(2);
  motion: TapeMotion;
  smooth: number;
  dcPole: number;
  noiseHp: number;
  noiseLp: number;
  noiseLow = 0;
  noiseHigh = 0;
  position = 0;
  model = 0;
  left = 0;
  right = 0;
  gain = 1;
  makeup = 1;
  trim = 1;
  noiseGain = 0;
  noise = 0;
  mix = 1;
  constructor(
    readonly rate: number,
    params: TapeParams,
  ) {
    this.controls = {
      ...TAPE_DEFAULTS,
      enabled: Number(TAPE_DEFAULTS.enabled),
      split: Number(TAPE_DEFAULTS.split),
    };
    for (const key of KEYS) this.controls[key] = params[key]?.[0] ?? this.controls[key];
    this.targets = { ...this.controls };
    this.model = Math.round(params.model?.[0] ?? 0);
    this.noiseOffsets = Float64Array.from(
      TAPE_MODELS,
      (model) => C.dbBase ** (model.hissDb / C.dbScale),
    );
    this.weights = new Float64Array(TAPE_MODELS.length);
    this.weights[this.model] = 1;
    this.tones = Array.from({ length: 2 * TAPE_MODELS.length }, () => new TapeTone(rate));
    this.noiseTones = Array.from({ length: TAPE_MODELS.length }, () => new TapeTone(rate));
    this.buffers = Array.from(
      { length: 2 },
      () => new Float32Array(Math.ceil(rate * C.maxDelaySeconds) + 2),
    );
    this.motion = new TapeMotion(rate, this.controls.seed);
    this.smooth = 1 - Math.exp(-1 / (rate * C.smoothSeconds));
    this.dcPole = Math.exp(-(2 * Math.PI * C.dcHz) / rate);
    this.noiseHp = 1 - Math.exp(-(2 * Math.PI * C.hissHighpassHz) / rate);
    this.noiseLp =
      1 - Math.exp(-(2 * Math.PI * Math.min(C.hissLowpassHz, rate * C.maxFrequencyRatio)) / rate);
    this.configure(params, 0);
  }
  configure(params: TapeParams, frames: number): void {
    for (const key of KEYS) this.targets[key] = params[key][0];
    // Preserve the running legacy macro when its dials are first separated.
    if (!this.controls.split && this.targets.split) {
      this.controls.wow = this.controls.wear;
      this.controls.flutter = this.controls.wear;
      this.controls.dropouts = this.controls.wear;
    }
    this.controls.split = this.targets.split;
    if (this.controls.seed !== this.targets.seed) {
      this.controls.seed = this.targets.seed;
      this.motion.state = this.targets.seed;
    }
    const model = Math.round(params.model[0]);
    if (model !== this.model && this.weights[model] === 0) {
      this.tones[model * 2].reset();
      this.tones[model * 2 + 1].reset();
      this.noiseTones[model].reset();
    }
    this.model = model;
    const k = 1 - Math.exp(-frames / (this.rate * C.toneSeconds));
    this.controls.bias += k * (this.targets.bias - this.controls.bias);
    if (Math.abs(this.targets.bias - this.controls.bias) < Number.EPSILON)
      this.controls.bias = this.targets.bias;
    for (let model = 0; model < TAPE_MODELS.length; model++) {
      this.tones[model * 2].configure(model, this.controls.bias);
      this.tones[model * 2 + 1].configure(model, this.controls.bias);
      this.noiseTones[model].configure(model, 0);
    }
  }
  tick(left: number, right: number): void {
    const s = this.controls,
      t = this.targets,
      k = this.smooth;
    s.drive += k * (t.drive - s.drive);
    s.wear += k * (t.wear - s.wear);
    s.wow += k * (t.wow - s.wow);
    s.flutter += k * (t.flutter - s.flutter);
    s.dropouts += k * (t.dropouts - s.dropouts);
    s.wowRate += k * (t.wowRate - s.wowRate);
    s.flutterRate += k * (t.flutterRate - s.flutterRate);
    s.hiss += k * (t.hiss - s.hiss);
    s.trim += k * (t.trim - s.trim);
    s.mix += k * (t.mix - s.mix);
    s.enabled += k * (t.enabled - s.enabled);
    this.updateGains();
    this.mix = s.mix * s.enabled;
    this.motion.wowRate = s.wowRate;
    this.motion.flutterRate = s.flutterRate;
    if (t.split) this.motion.tick(s.wow / C.percent, s.flutter / C.percent, s.dropouts / C.percent);
    else this.motion.tick(s.wear / C.percent);
    this.tickNoise();
    this.left = this.channel(left, 0);
    this.right = this.channel(right, 1);
    this.position = (this.position + 1) % this.buffers[0].length;
  }
  updateGains(): void {
    const s = this.controls;
    if (s.drive !== this.lastDrive) {
      this.lastDrive = s.drive;
      this.gain = C.dbBase ** (s.drive / C.dbScale);
      this.makeup = s.drive > 0 ? this.gain ** C.makeup : this.gain;
    }
    if (s.trim !== this.lastTrim) {
      this.lastTrim = s.trim;
      this.trim = C.dbBase ** (s.trim / C.dbScale);
    }
    if (s.hiss !== this.lastHiss) {
      this.lastHiss = s.hiss;
      this.hissGain = C.dbBase ** (s.hiss / C.dbScale);
    }
  }
  tickNoise(): void {
    const white = this.motion.random() * 2 - 1;
    this.noiseLow += this.noiseHp * (white - this.noiseLow);
    this.noiseHigh += this.noiseLp * (white - this.noiseLow - this.noiseHigh);
    let noise = 0;
    for (let model = 0; model < TAPE_MODELS.length; model++) {
      const target = model === this.model ? 1 : 0;
      this.weights[model] += this.smooth * (target - this.weights[model]);
      if (target === 0 && this.weights[model] < C.weightFloor) this.weights[model] = 0;
      if (target === 1 && 1 - this.weights[model] < C.weightFloor) this.weights[model] = 1;
      if (this.weights[model] === 0) continue;
      noise +=
        this.weights[model] *
        this.noiseTones[model].tick(this.noiseHigh) *
        this.noiseOffsets[model];
    }
    const targetGain = this.targets.hiss <= TAPE_BOUNDS.hiss[0] ? 0 : this.hissGain;
    this.noiseGain += this.smooth * (targetGain - this.noiseGain);
    this.noise = noise * this.noiseGain;
  }
  channel(input: number, channel: number): number {
    let tone = 0;
    for (let model = 0; model < TAPE_MODELS.length; model++) {
      if (this.weights[model] !== 0)
        tone += this.weights[model] * this.tones[model * 2 + channel].tick(input);
    }
    const y = Math.tanh(tone * this.gain);
    const shaped = (y + C.warmth * y * y + C.punch * y * y * y) / this.makeup;
    const dc = shaped - this.dcInput[channel] + this.dcPole * this.dcOutput[channel];
    this.dcInput[channel] = shaped;
    this.dcOutput[channel] = dc;
    const buffer = this.buffers[channel];
    buffer[this.position] = dc;
    const read = (this.position - this.motion.delay + buffer.length) % buffer.length;
    const index = Math.floor(read),
      frac = read - index;
    const delayed = buffer[index] + frac * (buffer[(index + 1) % buffer.length] - buffer[index]);
    const wet = (delayed + this.noise) * (1 - this.motion.dropout) * this.trim;
    // Exact initial dry/bypass, then smooth changes; snap sub-ulp residue for settled transparency.
    if (this.mix < Number.EPSILON) return input;
    return input + this.mix * (wet - input);
  }
}
export { TapeDsp };
export type { TapeParams };
