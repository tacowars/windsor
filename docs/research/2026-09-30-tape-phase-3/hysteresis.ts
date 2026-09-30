/** Scalar research adaptation of Jatin Chowdhury's CHOW Tape Jiles–Atherton
 * HysteresisOps.h and HysteresisProcessing.{h,cpp}, revision 604372e4ffd9690c3e283362e4598cb43edbb475.
 * SPDX-License-Identifier: GPL-3.0-only. See COPYING and AUDIT.md.
 * Windsor changes: higher-order small-Q series, symmetric finite guards,
 * explicit failure counters; RK2/RK4 only. No claim of CHOW render parity.
 * Fixed storage after construction. Tests: scripts/lib/tapePrototype.test.mjs.
 */
import { CORE as C } from './experimentConstants';
export type Solver = 'rk2' | 'rk4';

export class Hysteresis {
  m = 0;
  h = 0;
  derivative = 0;
  resets = 0;
  clips = 0;
  ms = 0;
  a = 0;
  c = 0;
  readonly period: number;
  constructor(
    readonly rate: number,
    readonly solver: Solver = 'rk4',
  ) {
    if (!(rate > 0) || !Number.isFinite(rate)) throw Error('Invalid rate');
    if (solver !== 'rk2' && solver !== 'rk4') throw Error('Invalid solver');
    this.period = 1 / rate;
    this.configure(C.drive, C.width, C.saturation);
  }
  configure(drive: number, width: number, saturation: number): void {
    if (
      !Number.isFinite(drive + width + saturation) ||
      Math.min(drive, width, saturation) < 0 ||
      Math.max(drive, width, saturation) > 1
    )
      throw Error('Research controls must be in [0, 1]');
    this.ms = C.saturationFloor + C.saturationScale * (1 - saturation);
    this.a = this.ms / (C.driveFloor + C.driveScale * drive);
    this.c = Math.sqrt(1 - width) - C.reversibleOffset;
  }
  reset(): void {
    this.m = this.h = this.derivative = 0;
  }
  slope(m: number, h: number, velocity: number): number {
    const q = (h + C.alpha * m) / this.a;
    let langevin: number, prime: number;
    if (Math.abs(q) < C.nearZero) {
      const q2 = q * q;
      langevin = q * (1 / 3 + q2 * (-1 / 45 + (q2 * 2) / 945));
      prime = 1 / 3 + q2 * (-1 / 15 + (q2 * 2) / 189);
    } else {
      const coth = 1 / Math.tanh(q);
      langevin = coth - 1 / q;
      prime = 1 + 1 / (q * q) - coth * coth;
    }
    const difference = this.ms * langevin - m;
    const direction = velocity >= 0 ? 1 : -1;
    const irreversible = direction * difference > 0 ? 1 - this.c : 0;
    const denominator = (1 - this.c) * direction * C.k - C.alpha * difference;
    const reversible = ((prime * this.ms) / this.a) * this.c;
    if (
      Math.abs(denominator) < C.denominatorFloor ||
      Math.abs(1 - C.alpha * reversible) < C.denominatorFloor
    )
      return NaN;
    return (
      (velocity * ((irreversible * difference) / denominator + reversible)) /
      (1 - C.alpha * reversible)
    );
  }
  tick(input: number): number {
    if (!Number.isFinite(input)) {
      this.reset();
      this.resets++;
      return 0;
    }
    const h = Math.max(-C.inputLimit, Math.min(C.inputLimit, input));
    if (h !== input) this.clips++;
    const d =
      ((1 + C.derivativeAlpha) / this.period) * (h - this.h) - C.derivativeAlpha * this.derivative;
    const halfH = (h + this.h) / 2,
      halfD = (d + this.derivative) / 2;
    const k1 = this.period * this.slope(this.m, this.h, this.derivative);
    const k2 = this.period * this.slope(this.m + k1 / 2, halfH, halfD);
    let m = this.m + k2;
    if (this.solver === 'rk4') {
      const k3 = this.period * this.slope(this.m + k2 / 2, halfH, halfD);
      const k4 = this.period * this.slope(this.m + k3, h, d);
      m = this.m + (k1 + 2 * k2 + 2 * k3 + k4) / 6;
    }
    if (!Number.isFinite(m) || Math.abs(m) > C.stateLimit) {
      this.reset();
      this.resets++;
      return 0;
    }
    this.m = m;
    this.h = h;
    this.derivative = d;
    return m;
  }
}
