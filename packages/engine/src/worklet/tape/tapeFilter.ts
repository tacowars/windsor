/** Preallocated RBJ shelves/peak; REELS model data with browser-independent coefficients.
 * Q is used as RBJ damping, not a claim of filtergraph~ bit parity. Tape render tests pin behavior. */
import { TAPE_DSP as C, TAPE_MODELS } from '../../inserts/tapeConstants';
type Shape = 'low' | 'high' | 'peak';
interface FilterOptions {
  shape: Shape;
  hz: number;
  gain: number;
  q: number;
  rate: number;
}
class TapeFilter {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  x1 = 0;
  x2 = 0;
  y1 = 0;
  y2 = 0;
  configure(o: FilterOptions): void {
    const a = Math.sqrt(o.gain);
    const w = (2 * Math.PI * Math.min(o.hz, o.rate * C.maxFrequencyRatio)) / o.rate;
    const c = Math.cos(w),
      alpha = Math.sin(w) / (2 * o.q),
      beta = 2 * Math.sqrt(a) * alpha;
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (o.shape === 'peak') {
      b0 = 1 + alpha * a;
      b1 = -(2 * c);
      b2 = 1 - alpha * a;
      a0 = 1 + alpha / a;
      a1 = -(2 * c);
      a2 = 1 - alpha / a;
    } else if (o.shape === 'low') {
      b0 = a * (a + 1 - (a - 1) * c + beta);
      b1 = 2 * a * (a - 1 - (a + 1) * c);
      b2 = a * (a + 1 - (a - 1) * c - beta);
      a0 = a + 1 + (a - 1) * c + beta;
      a1 = -(2 * (a - 1 + (a + 1) * c));
      a2 = a + 1 + (a - 1) * c - beta;
    } else {
      b0 = a * (a + 1 + (a - 1) * c + beta);
      b1 = -(2 * a * (a - 1 + (a + 1) * c));
      b2 = a * (a + 1 + (a - 1) * c - beta);
      a0 = a + 1 - (a - 1) * c + beta;
      a1 = 2 * (a - 1 - (a + 1) * c);
      a2 = a + 1 - (a - 1) * c - beta;
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
    this.y1 = y;
    return y;
  }
}
class TapeTone {
  filters = Array.from({ length: C.toneFilters }, () => new TapeFilter());
  options: FilterOptions;
  model = -1;
  bias = NaN;
  constructor(rate: number) {
    this.options = { shape: 'low', hz: 1, gain: 1, q: 1, rate };
  }
  configure(model: number, bias: number): void {
    if (model === this.model && bias === this.bias) return;
    this.model = model;
    this.bias = bias;
    const o = this.options;
    o.shape = 'low';
    o.hz = C.biasLowHz;
    o.q = C.biasLowQ;
    o.gain = C.dbBase ** ((-bias * C.biasDb) / C.percent / C.dbScale);
    this.filters[0].configure(o);
    o.shape = 'high';
    o.hz = C.biasHighHz;
    o.q = C.biasHighQ;
    o.gain = 1 / o.gain;
    this.filters[1].configure(o);
    const rows = TAPE_MODELS[model].eq;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      o.shape = row[0];
      o.hz = row[1];
      o.gain = row[2];
      o.q = row[3];
      this.filters[i + 2].configure(o);
    }
  }
  tick(x: number): number {
    for (let i = 0; i < this.filters.length; i++) x = this.filters[i].tick(x);
    return x;
  }
}
export { TapeTone };
