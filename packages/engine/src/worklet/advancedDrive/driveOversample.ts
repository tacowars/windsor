/** Windowed-sinc interpolation/decimation: actual 2x filtering with fixed storage.
 * One round trip delays by (length-1)/2 host samples; dry uses the same two filters.
 * A sample passes through fields (`input` in, `output` out), never as an
 * argument or a return, which V8 boxes across a call it does not inline
 * (worklet rule 2). Pinned by inserts/advancedDriveAllocation.test.ts.
 */
import { DRIVE_DSP as C, DRIVE_MATH as M } from '../../inserts/advancedDriveConstants';
function coefficients(): Float64Array {
  const h = new Float64Array(C.firLength);
  const center = (h.length - 1) / 2;
  let sum = 0;
  for (let i = 0; i < h.length; i++) {
    const x = i - center;
    const sinc =
      x === 0 ? 2 * C.firCutoff : Math.sin(2 * Math.PI * C.firCutoff * x) / (Math.PI * x);
    const window =
      M.blackmanA -
      M.half * Math.cos((2 * Math.PI * i) / (h.length - 1)) +
      M.blackmanB * Math.cos((M.four * Math.PI * i) / (h.length - 1));
    h[i] = sinc * window;
    sum += h[i];
  }
  for (let i = 0; i < h.length; i++) h[i] /= sum;
  return h;
}
const FIR = coefficients();
export class DriveFir {
  readonly buffer: Float64Array;
  cursor: number;
  input: number;
  output: number;
  constructor() {
    this.buffer = new Float64Array(FIR.length);
    this.cursor = 0;
    // Doubles first written as doubles (worklet rule 7), NaN until the first tick.
    this.input = this.output = NaN;
  }
  /** Filters `input` into `output`. */
  tick(): void {
    this.buffer[this.cursor] = this.input;
    let y = 0,
      j = this.cursor;
    for (let i = 0; i < FIR.length; i++) {
      y += FIR[i] * this.buffer[j];
      if (--j < 0) j = FIR.length - 1;
    }
    if (++this.cursor === FIR.length) this.cursor = 0;
    this.output = y;
  }
}
