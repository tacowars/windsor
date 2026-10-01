/** Stereo Tape: REELS Lite's EQ, motion and noise around Windsor's magnetic core. All state preallocated.
 * Per channel: Bias and model EQ → × driveGain(Drive) → the magnetic core at 2× or 4× (`tapeMagneticStage.ts`)
 * → DC block → transport delay → hiss → dropouts → trim; Mix and bypass read the dry signal delayed by the
 * core's fixed latency (windsor#224). Max noise/filter primitives are adapted; seeded renders exercise the
 * shipped processor (`inserts/tapeDsp.test.ts`, `tapeMagneticIntegration.test.ts`). A song's `core`
 * (windsor#291) arrives in four parameters, read each block into the stage's `custom` and its flag.
 * No double crosses a call on the render's path (worklet rule 2, windsor#228): the processor writes a
 * frame to `input` and calls `step`, a channel leaves its sample in `sample`, the EQ and the motion read
 * and write their own fields, and every double field (the controls' too) is first written as NaN
 * (rule 7). Pinned by `inserts/tapeAllocation.test.ts`.
 */
import {
  TAPE_BOUNDS,
  TAPE_DEFAULTS,
  TAPE_DSP as C,
  TAPE_MODELS,
} from '../../inserts/tapeConstants';
import { driveGain } from '../../inserts/tapeMagneticConstants';
import { TapeTone } from './tapeFilter';
import { assertMagneticRows } from './tapeMagneticRows';
import { TapeMagneticStage } from './tapeMagneticStage';
import { TapeMotion } from './tapeMotion';
type TapeParams = Record<string, Float32Array>;
const KEYS = Object.keys(TAPE_DEFAULTS) as Array<keyof typeof TAPE_DEFAULTS>;
type Controls = Record<(typeof KEYS)[number], number>;
/**
 * The controls, every one born a double (worklet rule 7). A class, not a literal: a literal with
 * `TAPE_DEFAULTS`' names would share its map's transitions, born as small integers and booleans.
 */
class TapeControlValues implements Controls {
  drive: number;
  bias: number;
  wear: number;
  wow: number;
  flutter: number;
  dropouts: number;
  wowRate: number;
  flutterRate: number;
  split: number;
  hiss: number;
  trim: number;
  mix: number;
  seed: number;
  enabled: number;
  oversampling: number;
  constructor() {
    this.drive = this.bias = this.wear = this.wow = this.flutter = this.dropouts = NaN;
    this.wowRate = this.flutterRate = this.split = this.hiss = this.trim = this.mix = NaN;
    this.seed = this.enabled = this.oversampling = NaN;
  }
  /**
   * Each parameter's value, by name. Not a loop over `KEYS`: a store keyed by a name that changes
   * is megamorphic, and V8 hands it each value boxed, a heap number per control per block.
   */
  read(params: TapeParams): void {
    this.drive = params.drive[0];
    this.bias = params.bias[0];
    this.wear = params.wear[0];
    this.wow = params.wow[0];
    this.flutter = params.flutter[0];
    this.dropouts = params.dropouts[0];
    this.wowRate = params.wowRate[0];
    this.flutterRate = params.flutterRate[0];
    this.split = params.split[0];
    this.hiss = params.hiss[0];
    this.trim = params.trim[0];
    this.mix = params.mix[0];
    this.seed = params.seed[0];
    this.enabled = params.enabled[0];
    this.oversampling = params.oversampling[0];
  }
}
// Refuse, when the bundle loads, a model row the core cannot normalise (design decision 6).
assertMagneticRows();
class TapeDsp {
  controls: TapeControlValues;
  targets: TapeControlValues;
  tones: TapeTone[];
  noiseTones: TapeTone[];
  weights: Float64Array;
  noiseOffsets: Float64Array;
  lastDrive = NaN;
  lastTrim = NaN;
  lastHiss = NaN;
  hissGain = NaN;
  buffers: Float32Array[];
  dcInput = new Float64Array(2);
  dcOutput = new Float64Array(2);
  motion: TapeMotion;
  magnetic: TapeMagneticStage;
  /** Test-only: skip the Bias and model EQ (`bypassEq`); not a parameter, never set from a song. */
  eqBypassed = false;
  smooth: number;
  dcPole: number;
  noiseHp: number;
  noiseLp: number;
  noiseLow = NaN;
  noiseHigh = NaN;
  position = 0;
  model = 0;
  /** The frame `step` reads, left and right. */
  input = new Float64Array(2);
  /** The frame `step` wrote. */
  left = NaN;
  right = NaN;
  /** The sample `channel` wrote. */
  sample = NaN;
  gain = NaN;
  trim = NaN;
  noiseGain = NaN;
  noise = NaN;
  mix = NaN;
  constructor(
    readonly rate: number,
    params: TapeParams,
  ) {
    this.hissGain = this.noiseLow = this.noiseHigh = this.left = this.right = this.sample = 0;
    this.noiseGain = this.noise = 0;
    this.gain = this.trim = this.mix = 1;
    this.controls = new TapeControlValues();
    for (const key of KEYS) this.controls[key] = Number(TAPE_DEFAULTS[key]);
    for (const key of KEYS) this.controls[key] = params[key]?.[0] ?? this.controls[key];
    this.targets = new TapeControlValues();
    for (const key of KEYS) this.targets[key] = this.controls[key];
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
    const core = params.core?.[0] === 1;
    this.magnetic = new TapeMagneticStage(
      rate,
      this.controls.oversampling,
      this.model,
      core
        ? {
            drive: params.coreDrive![0],
            width: params.coreWidth![0],
            saturation: params.coreSaturation![0],
          }
        : null,
    );
    this.smooth = 1 - Math.exp(-1 / (rate * C.smoothSeconds));
    this.dcPole = Math.exp(-(2 * Math.PI * C.dcHz) / rate);
    this.noiseHp = 1 - Math.exp(-(2 * Math.PI * C.hissHighpassHz) / rate);
    this.noiseLp =
      1 - Math.exp(-(2 * Math.PI * Math.min(C.hissLowpassHz, rate * C.maxFrequencyRatio)) / rate);
    this.configure(params, 0);
  }
  configure(params: TapeParams, frames: number): void {
    this.targets.read(params);
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
    const magnetic = this.magnetic;
    magnetic.select(params.oversampling[0]);
    // The song's `core` in place of the model's row while its flag is set (windsor#291).
    magnetic.overridden = params.core[0] === 1;
    magnetic.custom.drive = params.coreDrive[0];
    magnetic.custom.width = params.coreWidth[0];
    magnetic.custom.saturation = params.coreSaturation[0];
    magnetic.configure(model);
    const k = 1 - Math.exp(-frames / (this.rate * C.toneSeconds));
    this.controls.bias += k * (this.targets.bias - this.controls.bias);
    if (Math.abs(this.targets.bias - this.controls.bias) < Number.EPSILON)
      this.controls.bias = this.targets.bias;
    for (let model = 0; model < TAPE_MODELS.length; model++) {
      this.tones[model * 2].targetBias = this.controls.bias;
      this.tones[model * 2].configure(model);
      this.tones[model * 2 + 1].targetBias = this.controls.bias;
      this.tones[model * 2 + 1].configure(model);
      this.noiseTones[model].targetBias = 0;
      this.noiseTones[model].configure(model);
    }
  }
  /** Test-only: one frame through `step`, which the processor calls with `input` written. */
  tick(left: number, right: number): void {
    this.input[0] = left;
    this.input[1] = right;
    this.step();
  }
  /** One frame, from `input` to `left` and `right`. */
  step(): void {
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
    const motion = this.motion;
    motion.wowRate = s.wowRate;
    motion.flutterRate = s.flutterRate;
    if (t.split) {
      motion.wowAmount = s.wow / C.percent;
      motion.flutterAmount = s.flutter / C.percent;
      motion.dropoutAmount = s.dropouts / C.percent;
    } else motion.wowAmount = motion.flutterAmount = motion.dropoutAmount = s.wear / C.percent;
    motion.advance();
    this.tickNoise();
    if (this.magnetic.gliding) this.magnetic.glide();
    this.channel(0);
    this.left = this.sample;
    this.channel(1);
    this.right = this.sample;
    this.position = (this.position + 1) % this.buffers[0].length;
    this.magnetic.dryAt =
      this.magnetic.dryAt + 1 === this.magnetic.latency ? 0 : this.magnetic.dryAt + 1;
  }
  /** Test-only: route the input straight to Drive, skipping the Bias and model EQ (design decision 3's calibration). */
  bypassEq(bypassed: boolean): void {
    this.eqBypassed = bypassed;
  }
  updateGains(): void {
    const s = this.controls;
    if (s.drive !== this.lastDrive) {
      this.lastDrive = s.drive;
      this.gain = driveGain(s.drive);
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
    this.motion.draw();
    const white = this.motion.drawn * 2 - 1;
    this.noiseLow += this.noiseHp * (white - this.noiseLow);
    this.noiseHigh += this.noiseLp * (white - this.noiseLow - this.noiseHigh);
    let noise = 0;
    for (let model = 0; model < TAPE_MODELS.length; model++) {
      const target = model === this.model ? 1 : 0;
      this.weights[model] += this.smooth * (target - this.weights[model]);
      if (target === 0 && this.weights[model] < C.weightFloor) this.weights[model] = 0;
      if (target === 1 && 1 - this.weights[model] < C.weightFloor) this.weights[model] = 1;
      if (this.weights[model] === 0) continue;
      const tone = this.noiseTones[model];
      tone.value = this.noiseHigh;
      tone.advance();
      noise += this.weights[model] * tone.value * this.noiseOffsets[model];
    }
    const targetGain = this.targets.hiss <= TAPE_BOUNDS.hiss[0] ? 0 : this.hissGain;
    this.noiseGain += this.smooth * (targetGain - this.noiseGain);
    this.noise = noise * this.noiseGain;
  }
  /** One channel's sample, from `input[channel]` into `sample`. */
  channel(channel: number): void {
    const input = this.input[channel];
    let tone = this.eqBypassed ? input : 0;
    for (let model = 0; model < TAPE_MODELS.length && !this.eqBypassed; model++) {
      if (this.weights[model] === 0) continue;
      const eq = this.tones[model * 2 + channel];
      eq.value = input;
      eq.advance();
      tone += this.weights[model] * eq.value;
    }
    const core = this.magnetic.active[channel];
    core.input = tone * this.gain;
    core.advance();
    const shaped = core.output;
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
    // The dry path is exactly as late as the core's fixed delay (design decision 4).
    const ring = this.magnetic.dry,
      at = channel * this.magnetic.latency + this.magnetic.dryAt;
    const dry = ring[at];
    ring[at] = input;
    // Exact delayed dry/bypass, then smooth changes; snap sub-ulp residue for settled transparency.
    this.sample = this.mix < Number.EPSILON ? dry : dry + this.mix * (wet - dry);
  }
}
export { TapeDsp };
export type { TapeParams };
