// The voice drive's three shapes as `voiceDrive.ts` ships them, their
// antiderivatives, and the anti-aliasing candidates measured here: first-order
// antiderivative anti-aliasing (ADAA1) and halfband 2x / 4x oversampling.
// Research code: whole-signal, Float64, Math.log allowed. It is not the
// worklet's code and does not meet the worklet's rules.

export type Shape = 'soft' | 'hard' | 'fold';

/** The shipped curves (`VoiceDrive.curve`), operation for operation. */
export function curve(shape: Shape, x: number): number {
  switch (shape) {
    case 'hard':
      return x > 1 ? 1 : x < -1 ? -1 : x;
    case 'fold': {
      let u = x + 1;
      u -= 4 * Math.floor(u * 0.25);
      return 1 - Math.abs(u - 2);
    }
    default:
      return x > 3 ? 1 : x < -3 ? -1 : (x * (27 + x * x)) / (27 + 9 * x * x);
  }
}

// soft: x(27+x²)/(27+9x²) = x/9 + (8/3)·x/(x²+3), so F = x²/18 + (4/3)·ln(1 + x²/3)
// inside ±3 (the constant chosen so F(0) = 0), and |x| − 3 + F(3) outside.
const SOFT_F3 = 0.5 + (4 / 3) * Math.log(4);

/** An antiderivative of each curve, continuous everywhere. */
export function integral(shape: Shape, x: number): number {
  switch (shape) {
    case 'hard': {
      const m = Math.abs(x);
      return m <= 1 ? 0.5 * x * x : m - 0.5;
    }
    case 'fold': {
      // The triangle has period 4 and zero mean, so its integral is periodic.
      let v = x + 1;
      v -= 4 * Math.floor(v * 0.25);
      v -= 1; // v in [-1, 3)
      return v <= 1 ? 0.5 * v * v : 2 * v - 0.5 * v * v - 1;
    }
    default: {
      const m = Math.abs(x);
      if (m > 3) return m - 3 + SOFT_F3;
      return (x * x) / 18 + (4 / 3) * Math.log1p((x * x) / 3);
    }
  }
}

export interface Drive {
  shape: Shape;
  /** The shaper's input gain (`drive.gain`). */
  gain: number;
  bias: number;
}

/** As shipped: shape(g·x + b) − shape(b), one evaluation per host sample. */
export function naive(x: Float64Array, d: Drive): Float64Array {
  const y = new Float64Array(x.length);
  const off = curve(d.shape, d.bias);
  for (let i = 0; i < x.length; i++) y[i] = curve(d.shape, d.gain * x[i] + d.bias) - off;
  return y;
}

const ADAA_EPS = 1e-6;

/**
 * First-order ADAA: y[n] = (F(u[n]) − F(u[n−1])) / (u[n] − u[n−1]), the
 * curve at the midpoint when the step is too small to divide by. Half a
 * sample of delay, and on small signals the two-tap average (1 + z⁻¹)/2.
 */
export function adaa1(x: Float64Array, d: Drive): Float64Array {
  const y = new Float64Array(x.length);
  const off = curve(d.shape, d.bias);
  let up = d.bias;
  let Fp = integral(d.shape, up);
  for (let i = 0; i < x.length; i++) {
    const u = d.gain * x[i] + d.bias;
    const F = integral(d.shape, u);
    const du = u - up;
    y[i] = (Math.abs(du) > ADAA_EPS ? (F - Fp) / du : curve(d.shape, 0.5 * (u + up))) - off;
    up = u;
    Fp = F;
  }
  return y;
}

/* ------------------------------------------------------------------ *
 * Halfband 2x stages. A Kaiser-windowed halfband of length 4m + 3: every
 * odd tap but the centre is zero, so the up stage's odd phase is a pure
 * delay and each stage costs 2m + 2 multiplies per output.
 * ------------------------------------------------------------------ */

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
}

export function halfband(m: number, beta: number): Float64Array {
  const len = 4 * m + 3;
  const c = (len - 1) / 2;
  const h = new Float64Array(len);
  let sum = 0;
  for (let n = 0; n < len; n++) {
    const t = n - c;
    const sinc = t === 0 ? 0.5 : Math.sin(0.5 * Math.PI * t) / (Math.PI * t);
    const r = t / c;
    h[n] = sinc * (besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta));
    if (t !== 0 && t % 2 === 0) h[n] = 0;
    sum += h[n];
  }
  for (let n = 0; n < len; n++) h[n] /= sum;
  return h;
}

/** Up by 2: zero-stuff and filter, gain 2. Output length 2·x.length. */
export function up2(x: Float64Array, h: Float64Array): Float64Array {
  const c = (h.length - 1) / 2; // odd
  const m = (c - 1) / 2;
  const y = new Float64Array(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    let even = 0;
    for (let j = 0, n = 0; n < h.length; j++, n += 2) {
      const k = i - j;
      if (k >= 0) even += h[n] * x[k];
    }
    y[2 * i] = 2 * even;
    const k = i - m;
    y[2 * i + 1] = k >= 0 ? 2 * h[c] * x[k] : 0;
  }
  return y;
}

/** Filter and keep every other sample. Output length v.length / 2. */
export function down2(v: Float64Array, h: Float64Array): Float64Array {
  const c = (h.length - 1) / 2;
  const z = new Float64Array(v.length >> 1);
  for (let i = 0; i < z.length; i++) {
    const t = 2 * i;
    let acc = 0;
    for (let n = 0; n < h.length; n += 2) {
      const k = t - n;
      if (k >= 0) acc += h[n] * v[k];
    }
    const k = t - c;
    if (k >= 0) acc += h[c] * v[k];
    z[i] = acc;
  }
  return z;
}

export type Method = 'naive' | 'adaa1' | 'os2' | 'os2-adaa1' | 'os4' | 'iir2' | 'iir2-adaa1' | 'ref16';

/** The production halfband candidate: m = 11 (47 taps, 24 multiplies), β = 8. */
export const HB = halfband(11, 8);
/** The reference's halfband: long and steep, so its own leak sits far below the candidates'. */
export const HB_REF = halfband(47, 12);

function oversampled(x: Float64Array, d: Drive, stages: number, h: Float64Array, ad: boolean) {
  let v = x;
  for (let s = 0; s < stages; s++) v = up2(v, h);
  v = ad ? adaa1(v, d) : naive(v, d);
  for (let s = 0; s < stages; s++) v = down2(v, h);
  return v;
}

/** The host-rate delay each method adds, in samples, so a caller can align them. */
export function latency(method: Method): number {
  const c = (HB.length - 1) / 2;
  const cr = (HB_REF.length - 1) / 2;
  switch (method) {
    case 'naive':
      return 0;
    case 'adaa1':
      return 0.5;
    case 'os2':
      return c; // c at 2x, twice: c host samples
    case 'os2-adaa1':
      return c + 0.25;
    case 'os4':
      return c + c / 2; // stage 1 at 2x, stage 2 at 4x
    case 'ref16':
      return cr * (1 + 1 / 2 + 1 / 4 + 1 / 8);
    default:
      return 0; // the IIR's delay is frequency-dependent; the power reading needs none
  }
}

export function run(method: Method, x: Float64Array, d: Drive): Float64Array {
  switch (method) {
    case 'naive':
      return naive(x, d);
    case 'adaa1':
      return adaa1(x, d);
    case 'os2':
      return oversampled(x, d, 1, HB, false);
    case 'os2-adaa1':
      return oversampled(x, d, 1, HB, true);
    case 'os4':
      return oversampled(x, d, 2, HB, false);
    case 'ref16':
      return oversampled(x, d, 4, HB_REF, false);
    case 'iir2':
      return runIir(x, d, false);
    case 'iir2-adaa1':
      return runIir(x, d, true);
  }
}

/* ------------------------------------------------------------------ *
 * Polyphase IIR halfband (two allpass chains), the cheap 2x stage. The
 * coefficients follow the elliptic design in Laurent de Soras's HIIR
 * (public domain/WTFPL), from an attenuation and a transition width; the
 * realised response is measured by `iirCheck.mts`, not assumed.
 * ------------------------------------------------------------------ */

function transition(tb: number): { k: number; q: number } {
  let k = Math.tan(((1 - tb * 2) * Math.PI) / 4);
  k *= k;
  const kksqrt = (1 - k * k) ** 0.25;
  const e = (0.5 * (1 - kksqrt)) / (1 + kksqrt);
  const e2 = e * e;
  const e4 = e2 * e2;
  const q = e * (1 + e4 * (2 + e4 * (15 + 150 * e4)));
  return { k, q };
}

function accNum(q: number, order: number, c: number): number {
  let acc = 0, i = 0, j = 1, t: number;
  do {
    t = q ** (i * (i + 1)) * Math.sin(((i * 2 + 1) * c * Math.PI) / order) * j;
    acc += t;
    j = -j;
    i++;
  } while (Math.abs(t) > 1e-100);
  return acc;
}

function accDen(q: number, order: number, c: number): number {
  let acc = 0, i = 1, j = -1, t: number;
  do {
    t = q ** (i * i) * Math.cos((i * 2 * c * Math.PI) / order) * j;
    acc += t;
    j = -j;
    i++;
  } while (Math.abs(t) > 1e-100);
  return acc;
}

/** Allpass coefficients for `count` sections at transition width `tb` (of the low rate's band). */
export function iirHalfband(count: number, tb: number): Float64Array {
  const { k, q } = transition(tb);
  const order = count * 2 + 1;
  const a = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const c = i + 1;
    const ww = (accNum(q, order, c) * q ** 0.25) / (accDen(q, order, c) + 0.5);
    const wwsq = ww * ww;
    const x = Math.sqrt((1 - wwsq * k) * (1 - wwsq / k)) / (1 + wwsq);
    a[i] = (1 - x) / (1 + x);
  }
  return a;
}

/** One chain of first-order allpasses in z⁻² form, run at the low rate: y = c(x − y₋₁) + x₋₁. */
class Chain {
  readonly c: Float64Array;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  constructor(c: Float64Array) {
    this.c = c;
    this.xs = new Float64Array(c.length);
    this.ys = new Float64Array(c.length);
  }
  run(x: number): number {
    for (let i = 0; i < this.c.length; i++) {
      const y = this.c[i] * (x - this.ys[i]) + this.xs[i];
      this.xs[i] = x;
      this.ys[i] = y;
      x = y;
    }
    return x;
  }
}

function chains(a: Float64Array): [Chain, Chain] {
  const even = a.filter((_, i) => i % 2 === 0);
  const odd = a.filter((_, i) => i % 2 === 1);
  return [new Chain(Float64Array.from(even)), new Chain(Float64Array.from(odd))];
}

/** Up by 2: each input sample through both chains, the two outputs interleaved. */
export function iirUp2(x: Float64Array, a: Float64Array): Float64Array {
  const [p0, p1] = chains(a);
  const y = new Float64Array(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    y[2 * i] = p0.run(x[i]);
    y[2 * i + 1] = p1.run(x[i]);
  }
  return y;
}

/** Down by 2: the odd sample through one chain, the even through the other, averaged. */
export function iirDown2(v: Float64Array, a: Float64Array): Float64Array {
  const [p0, p1] = chains(a);
  const z = new Float64Array(v.length >> 1);
  for (let i = 0; i < z.length; i++) z[i] = 0.5 * (p0.run(v[2 * i + 1]) + p1.run(v[2 * i]));
  return z;
}

/** The IIR candidate: 8 allpass sections, transition 0.04. */
export const IIR = iirHalfband(8, 0.04);

export function runIir(x: Float64Array, d: Drive, ad: boolean): Float64Array {
  const v = iirUp2(x, IIR);
  return iirDown2(ad ? adaa1(v, d) : naive(v, d), IIR);
}
