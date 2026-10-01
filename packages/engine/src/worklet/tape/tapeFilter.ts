/** Preallocated RBJ shelves/peak; REELS model data with browser-independent coefficients.
 * Q is used as RBJ damping, not a claim of filtergraph~ bit parity. Tape render tests pin behavior.
 * The sample crosses no call as a double (worklet rule 2, windsor#228): a tone's `advance` runs its
 * filters over its own `value` in place, and the DSP hands a tone its Bias in `targetBias`. Every
 * double field is first written as NaN (rule 7). Pinned by `inserts/tapeAllocation.test.ts`. */
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
    this.b0 = this.b1 = this.b2 = this.a1 = this.a2 = NaN;
    this.x1 = this.x2 = this.y1 = this.y2 = NaN;
    this.b0 = 1;
    this.b1 = this.b2 = this.a1 = this.a2 = 0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
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
  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}
class TapeTone {
  filters = Array.from({ length: C.toneFilters }, () => new TapeFilter());
  options: FilterOptions;
  model = -1;
  /** The Bias last configured, and the one `configure` reads. */
  bias = NaN;
  targetBias = NaN;
  /** The sample `advance` filters in place. */
  value = NaN;
  constructor(rate: number) {
    this.options = { shape: 'low', hz: NaN, gain: NaN, q: NaN, rate };
    this.options.hz = this.options.gain = this.options.q = 1;
  }
  /** The filters for `model` at `targetBias`; nothing when neither changed. */
  configure(model: number): void {
    const bias = this.targetBias;
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
  reset(): void {
    for (let i = 0; i < this.filters.length; i++) this.filters[i].reset();
  }
  /**
   * `value` through every filter in turn, in place: the render's per-sample entry. Each filter's
   * difference equation is written here, not called: with the sample passed through the tone's
   * field to five calls, the render benched slower in Node than before windsor#228, and with the
   * chain here, faster.
   */
  advance(): void {
    let x = this.value;
    for (let i = 0; i < this.filters.length; i++) {
      const f = this.filters[i];
      const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
      f.x2 = f.x1;
      f.x1 = x;
      f.y2 = f.y1;
      f.y1 = y;
      x = y;
    }
    this.value = x;
  }
  /** Test-only: `x` through `advance`. */
  tick(x: number): number {
    this.value = x;
    this.advance();
    return this.value;
  }
}
export { TapeTone };
