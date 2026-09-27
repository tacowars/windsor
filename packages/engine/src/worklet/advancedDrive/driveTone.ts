/** Bilinear first-order tilt and its algebraic inverse; neutral settings are identity. */
import { driveGain } from '../../inserts/advancedDriveCurves';
export class DriveTone {
  b0: number;
  b1: number;
  a1: number;
  x1: number;
  y1: number;
  constructor() {
    this.b0 = 1;
    this.b1 = this.a1 = this.x1 = this.y1 = 0;
  }
  configure(db: number, hz: number, rate: number, inverse = false): void {
    const k = Math.tan((Math.PI * hz) / rate),
      hi = driveGain(db / 2),
      lo = 1 / hi;
    const b0 = (hi + lo * k) / (1 + k),
      b1 = (-hi + lo * k) / (1 + k),
      a1 = (k - 1) / (1 + k);
    this.b0 = inverse ? 1 / b0 : b0;
    this.b1 = inverse ? a1 / b0 : b1;
    this.a1 = inverse ? b1 / b0 : a1;
  }
  tick(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 - this.a1 * this.y1;
    this.x1 = x;
    this.y1 = y;
    return y;
  }
  reset(): void {
    this.x1 = this.y1 = 0;
  }
}
