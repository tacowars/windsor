/** Two cascaded Butterworth sections limit converter images; this is not an analog circuit model. */
import { RETRO_REVERB_DSP as C } from '../../inserts/retroReverbConstants';

class RetroFilter {
  b: Float64Array;
  a: Float64Array;
  z: Float64Array;

  constructor(rate: number) {
    const k = Math.tan((Math.PI * Math.min(C.bandwidth, rate * C.hostBandwidthRatio)) / rate);
    this.b = new Float64Array(C.filterSections);
    this.a = new Float64Array(C.filterSections * 2);
    this.z = new Float64Array(C.filterSections * 2);
    // Fourth-order Butterworth section Qs, calculated from its pole angles.
    for (let section = 0; section < C.filterSections; section++) {
      const q = 1 / (2 * Math.cos(((2 * section + 1) * Math.PI) / C.filterPoleDivisor));
      const divisor = 1 + k / q + k * k;
      this.b[section] = (k * k) / divisor;
      this.a[section * 2] = (2 * (k * k - 1)) / divisor;
      this.a[section * 2 + 1] = (1 - k / q + k * k) / divisor;
    }
  }

  tick(input: number): number {
    for (let section = 0; section < C.filterSections; section++) {
      const i = section * 2;
      const output = this.b[section] * input + this.z[i];
      const z0 = 2 * this.b[section] * input - this.a[i] * output + this.z[i + 1];
      const z1 = this.b[section] * input - this.a[i + 1] * output;
      this.z[i] = Math.abs(z0) < C.silenceFloor ? 0 : z0;
      this.z[i + 1] = Math.abs(z1) < C.silenceFloor ? 0 : z1;
      input = output;
    }
    return input;
  }
}

export { RetroFilter };
