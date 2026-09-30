/**
 * Stereo feedback compressor approximation (#660), shared with the worklet tests.
 * A soft-knee detector sees the signal AFTER the controlled gain, BEFORE makeup
 * and dry/wet. We solve that feedback implicitly with an analytic soft-knee solution,
 * avoiding a one-sample feedback instability at 0.01 ms / 10:1. This is a
 * behavioral model, not a circuit simulation. Range caps the control
 * voltage; Auto adds a slowly charging/releasing baseline to fast recovery.
 * No objects are allocated by configure(), advance(), or feedbackStep(), and no
 * double crosses a call on the worklet's path: the sample and its gain travel
 * through fields, and every field is `declare`d (this file also compiles in the
 * engine's project, whose class fields would be defined as `undefined` first)
 * and first written as a double (worklet rules 2 and 7, windsor#229). Pinned by
 * compressorAllocation.test.ts; compressorDsp.test.ts pins the behaviour.
 */
import { COMPRESSOR_DSP as C } from './compressorConstants';

export type CompressorParams = Record<string, Float32Array>;
const coeff = (seconds: number, rate: number): number => -Math.expm1(-1 / (seconds * rate));

/** Implicit Euler feedback envelope with a continuously differentiable knee. */
export function feedbackStep(over: number, previous: number, slope: number, speed: number): number {
  const half = C.kneeDb / 2;
  const released = previous / (1 + speed);
  if (over - released <= -half) return released;
  const compressed = (previous + speed * slope * over) / (1 + speed * (1 + slope));
  if (over - compressed >= half) return Math.max(0, compressed);
  // Inside the knee the implicit equation is quadratic. This root form avoids
  // cancellation when over is near the lower edge; no iteration is necessary.
  const b = (speed * slope) / (2 * C.kneeDb);
  const c = 1 + speed;
  const d = previous - c * (over + half);
  const y = -(2 * d) / (c + Math.sqrt(c * c - C.quadraticFactor * b * d));
  return Math.max(0, over + half - y);
}

export class CompressorDsp {
  declare reductionDb: number;
  /** Effective scalar applied to program audio (dry/wet and bypass included): `advance`'s result. */
  declare gain: number;
  /** The detector's two channels for the next `advance`. */
  declare keyLeft: number;
  declare keyRight: number;
  declare private slow: number;
  declare private fast: number;
  declare private lowL: number;
  declare private lowR: number;
  declare private threshold: number;
  declare private makeup: number;
  declare private mix: number;
  declare private range: number;
  declare private enabled: number;
  declare private ratio: number;
  declare private highpass: number;
  declare private attack: number;
  declare private release: number;
  declare private attackSpeed: number;
  declare private releaseSpeed: number;
  declare private hpSpeed: number;
  declare private readonly rate: number;
  declare private readonly smoothing: number;
  declare private readonly slowCharge: number;
  declare private readonly slowRelease: number;
  declare private params: CompressorParams;

  constructor(rate: number, params: CompressorParams) {
    // Every double is first written as one (NaN), so V8 never has to generalise
    // a small-integer field to a double later (worklet rule 7).
    this.reductionDb = this.gain = this.keyLeft = this.keyRight = NaN;
    this.slow = this.fast = this.lowL = this.lowR = NaN;
    this.threshold = this.makeup = this.mix = this.range = this.enabled = this.ratio = NaN;
    this.highpass = this.attack = this.release = NaN;
    this.attackSpeed = this.releaseSpeed = this.hpSpeed = NaN;
    this.rate = this.smoothing = this.slowCharge = this.slowRelease = NaN;
    this.reductionDb = 0;
    this.gain = 1;
    this.keyLeft = this.keyRight = 0;
    this.slow = this.fast = this.lowL = this.lowR = 0;
    this.rate = rate;
    this.params = params;
    this.threshold = params.threshold![0]!;
    this.makeup = params.makeup![0]!;
    this.mix = params.mix![0]!;
    this.range = params.range![0]!;
    this.enabled = params.enabled![0]!;
    this.ratio = params.ratio![0]!;
    this.smoothing = coeff(C.smoothSeconds, rate);
    this.slowCharge = coeff(C.autoChargeSeconds, rate);
    this.slowRelease = coeff(C.autoSlowSeconds, rate);
    this.configure(params, true);
  }

  configure(params: CompressorParams, initial = false): void {
    this.params = params;
    const attack = params.attack![0]!;
    const release = params.release![0]!;
    const highpass = params.highpass![0]!;
    if (initial || attack !== this.attack) {
      this.attack = attack;
      // The implicit feedback slope is ratio-dependent; scale time accordingly.
      this.attackSpeed = 1 / (attack * C.msToSeconds * this.rate);
    }
    if (initial || release !== this.release) {
      // Either direction continues from the gain being heard. In manual mode
      // the unused slow envelope may still be high: do not restore it on Auto.
      this.fast = this.reductionDb;
      this.slow = this.reductionDb;
      this.release = release;
      // `coeff`, written in place: V8 does not inline a call on a branch this
      // rare, and would box the double it returns.
      this.releaseSpeed = -Math.expm1(-1 / ((release || C.autoFastSeconds) * this.rate));
    }
    if (initial || highpass !== this.highpass) {
      this.highpass = highpass;
      this.hpSpeed = -Math.expm1((-(2 * Math.PI) * highpass) / this.rate);
    }
  }

  /** One sample from `left` and `right`, returning the gain: the tests' form of `advance`. */
  tick(left: number, right: number): number {
    this.keyLeft = left;
    this.keyRight = right;
    this.advance();
    return this.gain;
  }

  /**
   * One sample from `keyLeft` and `keyRight` into `gain` and `reductionDb`. The
   * sample travels through fields, not arguments or a return: V8 boxes a
   * double that crosses a call it does not inline, and this one is too long to
   * inline into the worklet's loop. Rectify each channel separately:
   * opposite-polarity stereo must not cancel.
   */
  advance(): void {
    const left = this.keyLeft;
    const right = this.keyRight;
    this.smooth();
    this.lowL += this.hpSpeed * (left - this.lowL);
    this.lowR += this.hpSpeed * (right - this.lowR);
    const keyL = this.highpass > 0 ? left - this.lowL : left;
    const keyR = this.highpass > 0 ? right - this.lowR : right;
    const level = Math.log(Math.max(C.floor, Math.abs(keyL), Math.abs(keyR))) / C.dbToLog;
    const over = level - this.threshold;
    const slope = this.ratio - 1;
    const candidate = feedbackStep(over, this.fast, slope, this.attackSpeed / this.ratio);
    const releasing = candidate < this.fast;
    let next = releasing ? feedbackStep(over, this.fast, slope, this.releaseSpeed) : candidate;
    next = Math.min(this.range, next);
    this.fast = next;
    this.slow = Math.min(this.range, this.slow);
    this.slow += (next > this.slow ? this.slowCharge : this.slowRelease) * (next - this.slow);
    if (this.release === 0) next = Math.max(next, this.slow);
    this.reductionDb = Math.min(this.range, next);
    const wet = Math.exp((this.makeup - this.reductionDb) * C.dbToLog);
    this.gain = 1 + this.enabled * this.mix * (wet - 1);
  }

  private smooth(): void {
    const p = this.params;
    const a = this.smoothing;
    this.threshold += a * (p.threshold![0]! - this.threshold);
    this.makeup += a * (p.makeup![0]! - this.makeup);
    this.mix += a * (p.mix![0]! - this.mix);
    this.range += a * (p.range![0]! - this.range);
    this.enabled += a * (p.enabled![0]! - this.enabled);
    this.ratio += a * (p.ratio![0]! - this.ratio);
    // Settle exact endpoints: a dry/bypassed insert eventually is bit-identical.
    if (Math.abs(this.mix - p.mix![0]!) < C.floor) this.mix = p.mix![0]!;
    if (Math.abs(this.enabled - p.enabled![0]!) < C.floor) this.enabled = p.enabled![0]!;
  }
}
