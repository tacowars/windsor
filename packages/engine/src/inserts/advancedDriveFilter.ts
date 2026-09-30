/** RBJ biquads (W3C Audio EQ Cookbook); shared coefficients drive the displayed response.
 * The audio thread passes each sample through fields (`x0` in, `y1` out), so no
 * double crosses a call V8 may not inline, where it would box one (worklet
 * rule 2). The fields are `declare`d, since this file also compiles in the
 * engine's project, whose class fields would otherwise be defined as
 * `undefined` first, and each is first written as a double (NaN), so V8 never
 * generalises it (rule 7). The peak's decibel gain is written in place, not
 * called (see advancedDriveCurves.ts). Pinned by
 * inserts/advancedDriveAllocation.test.ts.
 */
import { DRIVE_DSP as C, DRIVE_MATH as M } from './advancedDriveConstants';
export interface DriveFilterOptions {
  type: string;
  hz: number;
  q: number;
  gain: number;
  rate: number;
}
export class DriveFilter {
  /** The sample `tick` filters. */
  declare x0: number;
  declare b0: number;
  declare b1: number;
  declare b2: number;
  declare a1: number;
  declare a2: number;
  declare x1: number;
  declare x2: number;
  /** The newest output: `tick`'s result. */
  declare y1: number;
  declare y2: number;
  constructor() {
    this.x0 = this.b0 = this.b1 = this.b2 = this.a1 = this.a2 = NaN;
    this.x1 = this.x2 = this.y1 = this.y2 = NaN;
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
      const a = Math.sqrt(M.decimal ** (o.gain / C.dbDivisor));
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
  /** Filters `x0` into `y1`. */
  tick(): void {
    const x = this.x0;
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = Number.isFinite(y) ? Math.max(-C.maxInternal, Math.min(C.maxInternal, y)) : 0;
  }
  /** Filters `source`'s newest output: the next section of a chain. */
  follow(source: DriveFilter): void {
    this.x0 = source.y1;
    this.tick();
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
