/** RBJ biquads (W3C Audio EQ Cookbook); shared coefficients drive the displayed response. */
import { DRIVE_DSP as C } from './advancedDriveConstants';
import { driveGain } from './advancedDriveCurves';
export interface DriveFilterOptions {
  type: string;
  hz: number;
  q: number;
  gain: number;
  rate: number;
}
export class DriveFilter {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  constructor() {
    this.b0 = 1;
    this.b1 = this.b2 = this.a1 = this.a2 = this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  configure(o: DriveFilterOptions): void {
    const w = (2 * Math.PI * Math.min(o.rate * C.maxFrequencyRatio, Math.max(1, o.hz))) / o.rate;
    const c = Math.cos(w),
      alpha = Math.sin(w) / (2 * o.q);
    let a0 = 1 + alpha,
      a1 = -(2 * c),
      a2 = 1 - alpha;
    let b0 = (1 - c) / 2,
      b1 = 1 - c,
      b2 = b0;
    if (o.type === 'highpass') {
      b0 = b2 = (1 + c) / 2;
      b1 = -(1 + c);
    }
    if (o.type === 'bandpass') {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    if (o.type === 'notch') {
      b0 = b2 = 1;
      b1 = -(2 * c);
    }
    if (o.type === 'allpass') {
      b0 = a2;
      b1 = a1;
      b2 = a0;
    }
    if (o.type === 'peak') {
      const a = Math.sqrt(driveGain(o.gain));
      b0 = 1 + alpha * a;
      b1 = -(2 * c);
      b2 = 1 - alpha * a;
      a0 = 1 + alpha / a;
      a1 = -(2 * c);
      a2 = 1 - alpha / a;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  tick(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = Number.isFinite(y) ? Math.max(-C.maxInternal, Math.min(C.maxInternal, y)) : 0;
    return this.y1;
  }
  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  magnitude(hz: number, rate: number): number {
    const w = (2 * Math.PI * hz) / rate;
    const nr = this.b0 + this.b1 * Math.cos(w) + this.b2 * Math.cos(2 * w);
    const ni = -this.b1 * Math.sin(w) - this.b2 * Math.sin(2 * w);
    const dr = 1 + this.a1 * Math.cos(w) + this.a2 * Math.cos(2 * w);
    const di = -this.a1 * Math.sin(w) - this.a2 * Math.sin(2 * w);
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }
}
