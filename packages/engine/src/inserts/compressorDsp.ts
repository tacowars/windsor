/**
 * Stereo feedback compressor approximation (#660), shared with the worklet tests.
 * A soft-knee detector sees the signal AFTER the controlled gain, BEFORE makeup
 * and dry/wet. We solve that feedback implicitly with an analytic soft-knee solution,
 * avoiding a one-sample feedback instability at 0.01 ms / 10:1. This is a
 * behavioral model, not a circuit simulation. Range caps the control
 * voltage; Auto adds a slowly charging/releasing baseline to fast recovery.
 * No objects are allocated by configure(), tick(), or feedbackStep().
 */
import { COMPRESSOR_DEFAULTS as D, COMPRESSOR_DSP as C } from './compressorConstants';

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
  reductionDb = 0;
  /** Effective scalar applied to program audio (dry/wet and bypass included). */
  gain = 1;
  private slow = 0;
  private fast = 0;
  private lowL = 0;
  private lowR = 0;
  private threshold: number = D.threshold;
  private makeup: number = D.makeup;
  private mix: number = D.mix;
  private range: number = D.range;
  private enabled = 1;
  private ratio: number = D.ratio;
  private highpass: number = D.highpass;
  private attack: number = D.attack;
  private release: number = D.release;
  private attackSpeed = 0;
  private releaseSpeed = 0;
  private hpSpeed = 0;
  private readonly smoothing: number;
  private readonly slowCharge: number;
  private readonly slowRelease: number;
  private params: CompressorParams;

  constructor(
    private readonly rate: number,
    params: CompressorParams,
  ) {
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
      this.releaseSpeed = coeff(release || C.autoFastSeconds, this.rate);
    }
    if (initial || highpass !== this.highpass) {
      this.highpass = highpass;
      this.hpSpeed = -Math.expm1((-(2 * Math.PI) * highpass) / this.rate);
    }
  }

  /** Rectify each channel separately: opposite-polarity stereo must not cancel. */
  tick(left: number, right: number): number {
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
    return this.gain;
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
