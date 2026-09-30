/** Bilinear first-order tilt and its algebraic inverse; neutral settings are identity.
 * Its operands pass through fields (`db` and `hz` for `configure`, `x0` in and
 * `y1` out for `tick`), never as arguments or returns, which V8 boxes across a
 * call it does not inline (worklet rule 2); its decibel gain is written in
 * place, not called (advancedDriveCurves.ts). Pinned by
 * inserts/advancedDriveAllocation.test.ts.
 */
import { DRIVE_DSP as C, DRIVE_MATH as M } from '../../inserts/advancedDriveConstants';
export class DriveTone {
  readonly rate: number;
  /** The tilt `configure` designs, in dB, and its pivot. */
  db: number;
  hz: number;
  b0: number;
  b1: number;
  a1: number;
  /** The sample `tick` filters. */
  x0: number;
  x1: number;
  /** The newest output: `tick`'s result. */
  y1: number;
  constructor(rate: number) {
    this.rate = rate;
    // Doubles first written as doubles (worklet rule 7), then the identity.
    this.db = this.hz = this.b0 = this.b1 = this.a1 = this.x0 = this.x1 = this.y1 = NaN;
    this.b0 = 1;
    this.b1 = this.a1 = this.x1 = this.y1 = 0;
  }
  configure(inverse: boolean): void {
    const k = Math.tan((Math.PI * this.hz) / this.rate),
      hi = M.decimal ** (this.db / 2 / C.dbDivisor),
      lo = 1 / hi;
    const b0 = (hi + lo * k) / (1 + k),
      b1 = (-hi + lo * k) / (1 + k),
      a1 = (k - 1) / (1 + k);
    this.b0 = inverse ? 1 / b0 : b0;
    this.b1 = inverse ? a1 / b0 : b1;
    this.a1 = inverse ? b1 / b0 : a1;
  }
  /** Filters `x0` into `y1`. */
  tick(): void {
    const x = this.x0;
    const y = this.b0 * x + this.b1 * this.x1 - this.a1 * this.y1;
    this.x1 = x;
    this.y1 = y;
  }
  reset(): void {
    this.x1 = this.y1 = 0;
  }
}
