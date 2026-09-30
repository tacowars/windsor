/**
 * The Parametric EQ's section forms (windsor#198): one second-order (or
 * first-order) section at a time, for `eqCoefficients.ts` to cascade.
 *
 * Provenance: bells, cuts and the pole placement of every section follow
 * M. Vicanek, *Matched Second Order Digital Filters* (2016,
 * https://vicanek.de/articles/BiquadFits.pdf): the analog prototype's poles
 * are mapped exactly (impulse invariance), and the numerator is solved from
 * the prototype's magnitude at chosen frequencies, which keeps the analog
 * shape up to Nyquist where the bilinear transform cramps it. The paper's
 * peaking EQ matches DC and the value and slope at the centre; its lowpass
 * matches DC and the corner's gain (b2 = 0), and its highpass the corner's
 * gain over a double zero at DC; the first-order cuts here follow the same
 * two forms at −3 dB. The same method is applied here to the notch (exact
 * zeros at the centre, DC matched) and the shelves (DC, the corner and the
 * prototype's zero frequency, capped at Nyquist; a cut is designed as the
 * inverse of the boost, so the mapped poles always lie below the corner). The
 * measurement that chose these over the bilinear forms is in
 * `docs/research/2026-09-30-parametric-eq/README.md`; the prototypes are
 * `eqAnalog.ts`.
 *
 * Invariants: the forms read and write the fields of `v` and never take or
 * return a double, because V8 boxes a double that crosses a call it does not
 * inline, and this runs on the audio thread every refresh while a band
 * glides: nothing here allocates. Every section's poles lie inside the unit
 * circle for every value in range. Pinned by `eqCoefficients.test.ts` and the
 * allocation check in `eqDsp.test.ts`.
 */
import { EQ_MATH as M, EQ_SECTION as X, EQ_SHELF_MIN_SEPARATION } from './eqConstants';

/** The working values of the section being designed, and the section itself (a0 = 1). */
export const v = {
  /** The band's corner (radians per sample), Q and heard gain (dB). */
  w0: 0,
  q: 1,
  gain: 0,
  /** The poles' natural frequency and Q, for `matchPoles`. */
  pw: 0,
  pq: 1,
  /** A frequency, and cos²(w/2), sin²(w/2) and 4 cos² sin² there (Vicanek's basis). */
  w: 0,
  p0: 1,
  p1: 0,
  p2: 0,
  /** A numerator's power in that basis, for `numerator`. */
  P0: 0,
  P1: 0,
  P2: 0,
  /** A shelf's amplitude, its third fitting point, a ratio to the corner and the power there. */
  A: 1,
  w3: 0,
  ratio: 1,
  power: 1,
  /** The prototype's power at a cut's corner. */
  corner: 1,
  b0: 1,
  b1: 0,
  b2: 0,
  a1: 0,
  a2: 0,
};

export function setPhi(): void {
  const c = Math.cos(v.w * M.half);
  const n = Math.sin(v.w * M.half);
  v.p0 = c * c;
  v.p1 = n * n;
  v.p2 = M.four * v.p0 * v.p1;
}

export function store(out: Float64Array, at: number): void {
  out[at + X.b0] = v.b0;
  out[at + X.b1] = v.b1;
  out[at + X.b2] = v.b2;
  out[at + X.a1] = v.a1;
  out[at + X.a2] = v.a2;
}

export function identity(): void {
  v.b0 = 1;
  v.b1 = v.b2 = v.a1 = v.a2 = 0;
}

/** The exact image of the poles of s² + s pw/pq + pw² (pw in radians per sample). */
function matchPoles(): void {
  const zeta = 1 / (2 * v.pq);
  const r = Math.exp(-zeta * v.pw);
  v.a1 =
    zeta <= 1
      ? -(2 * r * Math.cos(v.pw * Math.sqrt(1 - zeta * zeta)))
      : -(2 * r * Math.cosh(v.pw * Math.sqrt(zeta * zeta - 1)));
  v.a2 = r * r;
}

/** The denominator's power at the current basis, into `v.power`. */
function denominatorPower(): void {
  const d0 = 1 + v.a1 + v.a2;
  const d1 = 1 - v.a1 + v.a2;
  v.power = d0 * d0 * v.p0 + d1 * d1 * v.p1 - M.four * v.a2 * v.p2;
}

/**
 * The minimum-phase numerator whose power is P0 φ0 + P1 φ1 + P2 φ2. False
 * when no real quadratic has that power or its zeros are not inside the unit
 * circle: the fit is then clamped, and a shelf falls back.
 */
function numerator(): boolean {
  const r0 = Math.sqrt(v.P0);
  const r1 = Math.sqrt(Math.max(0, v.P1));
  const w = M.half * (r0 + r1);
  const disc = w * w + v.P2;
  v.b0 = M.half * (w + Math.sqrt(Math.max(0, disc)));
  v.b1 = M.half * (r0 - r1);
  v.b2 = -v.P2 / (M.four * v.b0);
  const r = v.b2 / v.b0;
  return v.P1 >= 0 && disc >= 0 && Math.abs(r) < 1 && Math.abs(v.b1 / v.b0) < 1 + r;
}

/** Peaking EQ: poles at Q·A, DC matched, and the centre's value and slope matched. */
export function bell(): void {
  const A = Math.pow(M.decimal, v.gain / M.shelfDbPerDecade);
  v.pw = v.w0;
  v.pq = v.q * A;
  matchPoles();
  const d0 = (1 + v.a1 + v.a2) ** 2;
  const d1 = (1 - v.a1 + v.a2) ** 2;
  const d2 = -M.four * v.a2;
  v.w = v.w0;
  setPhi();
  const g2 = A * A * A * A;
  const r1 = (d0 * v.p0 + d1 * v.p1 + d2 * v.p2) * g2;
  const r2 = (-d0 + d1 + M.four * (v.p0 - v.p1) * d2) * g2;
  v.P0 = d0;
  v.P2 = (r1 - r2 * v.p1 - d0) / (M.four * v.p1 * v.p1);
  v.P1 = r2 + d0 + M.four * (v.p1 - v.p0) * v.P2;
  numerator();
}

/**
 * A low- or highpass over the poles already matched: the prototype's power at
 * the corner (`v.corner`) is matched, with DC for the lowpass (one zero at Nyquist left free, b2 = 0) or
 * a double zero at DC for a second-order highpass. `order` 1 is the
 * first-order form (a2 = 0, one zero).
 */
function pass(highpass: boolean, order: number): void {
  v.w = v.w0;
  setPhi();
  denominatorPower();
  const d = v.power * v.corner;
  if (highpass) {
    // |1 − z⁻¹|² = 4φ1, so the double zero's power is 16φ1².
    v.b0 = order === 1 ? Math.sqrt(d / (M.four * v.p1)) : Math.sqrt(d) / (M.four * v.p1);
    v.b1 = -order * v.b0;
    v.b2 = order === 1 ? 0 : v.b0;
    return;
  }
  const dc = 1 + v.a1 + v.a2;
  const r1 = Math.sqrt(Math.max(0, (d - dc * dc * v.p0) / v.p1));
  v.b0 = M.half * (dc + r1);
  v.b1 = dc - v.b0;
  v.b2 = 0;
}

/** Second-order low- or highpass at Q `v.pq`: poles matched, the corner's gain Q matched. */
export function pass2(highpass: boolean): void {
  v.pw = v.w0;
  matchPoles();
  v.corner = v.pq * v.pq;
  pass(highpass, 2);
}

/** First-order low- or highpass: the pole matched, the corner's −3 dB matched. */
export function pass1(highpass: boolean): void {
  v.a1 = -Math.exp(-v.w0);
  v.a2 = 0;
  v.corner = M.half;
  pass(highpass, 1);
}

/** Notch: poles matched, zeros exactly on the unit circle at the centre, DC matched. */
export function notch(): void {
  v.pw = v.w0;
  v.pq = v.q;
  matchPoles();
  const half = Math.sin(v.w0 * M.half);
  v.b0 = v.b2 = (1 + v.a1 + v.a2) / (M.four * half * half);
  v.b1 = -(2 * Math.cos(v.w0) * v.b0);
}

/** The shelf prototype's power at `v.ratio` (`eqAnalog.analogShelfPower`), into `v.power`. */
function shelfPower(low: boolean): void {
  const A = v.A;
  const b = Math.sqrt(A) / v.q;
  const w = v.ratio;
  const re1 = low ? A - w * w : 1 - A * w * w;
  const re2 = low ? 1 - A * w * w : A - w * w;
  v.power = (A * A * (re1 * re1 + b * b * w * w)) / (re2 * re2 + b * b * w * w);
}

/** Fit the shelf's numerator to its prototype at DC, the corner and `v.w3`. */
function shelfFit(low: boolean): boolean {
  const top = v.A * v.A;
  const dc = (1 + v.a1 + v.a2) ** 2 * (low ? top * top : 1);
  v.w = v.w0;
  setPhi();
  denominatorPower();
  const da = v.power;
  v.ratio = 1;
  shelfPower(low);
  const ra = v.power * da - dc * v.p0;
  const pa1 = v.p1;
  const pa2 = v.p2;
  v.w = v.w3;
  setPhi();
  denominatorPower();
  const db = v.power;
  v.ratio = v.w3 / v.w0;
  shelfPower(low);
  const rb = v.power * db - dc * v.p0;
  const det = pa1 * v.p2 - pa2 * v.p1;
  v.P0 = dc;
  v.P1 = (ra * v.p2 - pa2 * rb) / det;
  v.P2 = (pa1 * rb - ra * v.p1) / det;
  return numerator();
}

/** The cookbook's prewarped bilinear shelf: the stable fallback when no matched fit exists. */
function bilinearShelf(low: boolean): void {
  const A = Math.pow(M.decimal, v.gain / M.shelfDbPerDecade);
  const c = Math.cos(v.w0);
  const k = Math.sqrt(A) * (Math.sin(v.w0) / v.q);
  const sign = low ? 1 : -1;
  const a0 = A + 1 + sign * (A - 1) * c + k;
  v.b0 = (A * (A + 1 - sign * (A - 1) * c + k)) / a0;
  v.b1 = (sign * 2 * A * (A - 1 - sign * (A + 1) * c)) / a0;
  v.b2 = (A * (A + 1 - sign * (A - 1) * c - k)) / a0;
  v.a1 = (-sign * 2 * (A - 1 + sign * (A + 1) * c)) / a0;
  v.a2 = (A + 1 + sign * (A - 1) * c - k) / a0;
}

/** A matched shelf: the half whose poles sit below the corner, inverted for the other half. */
export function shelf(low: boolean): void {
  const invert = low ? v.gain < 0 : v.gain > 0;
  v.A = Math.pow(M.decimal, (invert ? -v.gain : v.gain) / M.shelfDbPerDecade);
  const root = Math.sqrt(v.A);
  v.pw = low ? v.w0 / root : v.w0 * root;
  v.pq = v.q;
  matchPoles();
  const zero = low ? v.w0 * root : v.w0 / root;
  v.w3 = Math.min(Math.PI, Math.max(zero, v.w0 * EQ_SHELF_MIN_SEPARATION));
  if (!shelfFit(low)) {
    v.w3 = Math.PI;
    if (!shelfFit(low)) return bilinearShelf(low);
  }
  if (!invert) return;
  const { b0, b1, b2, a1, a2 } = v;
  v.b0 = 1 / b0;
  v.b1 = a1 / b0;
  v.b2 = a2 / b0;
  v.a1 = b1 / b0;
  v.a2 = b2 / b0;
}
