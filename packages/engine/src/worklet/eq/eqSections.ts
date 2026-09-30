/**
 * The Parametric EQ's sample loops (windsor#198): a band's sections run in
 * place over the stereo work buffers, and the crossfades that fade a band, or
 * the whole EQ, against its own input.
 *
 * Invariants: transposed direct form II with the state held in doubles, one
 * section at a time over the whole piece (both channels in one pass), and
 * nothing allocated. A fade follows a smoothstep of its linear phase, so its
 * gain has no corner at either end. Pinned by `inserts/eqDsp.test.ts`.
 */
import { EQ_DSP as D, EQ_MATH as M, EQ_SECTION as X } from '../../inserts/eqConstants';
import type { EqBand } from './eqBand';

const PER = D.coefficientsPerSection;
const ST = D.statePerSection;

/** Run `band`'s sections in place over the first `frames` of `left` and `right`. */
export function runSections(
  band: EqBand,
  left: Float64Array,
  right: Float64Array,
  frames: number,
): void {
  const c = band.coeffs;
  const s = band.state;
  for (let k = 0; k < band.sections; k++) {
    const o = k * PER;
    const z = k * ST;
    const b0 = c[o + X.b0];
    const b1 = c[o + X.b1];
    const b2 = c[o + X.b2];
    const a1 = c[o + X.a1];
    const a2 = c[o + X.a2];
    let l1 = s[z + X.left1];
    let l2 = s[z + X.left2];
    let r1 = s[z + X.right1];
    let r2 = s[z + X.right2];
    for (let i = 0; i < frames; i++) {
      const xl = left[i];
      const yl = b0 * xl + l1;
      l1 = b1 * xl - a1 * yl + l2;
      l2 = b2 * xl - a2 * yl;
      left[i] = yl;
      const xr = right[i];
      const yr = b0 * xr + r1;
      r1 = b1 * xr - a1 * yr + r2;
      r2 = b2 * xr - a2 * yr;
      right[i] = yr;
    }
    s[z + X.left1] = l1;
    s[z + X.left2] = l2;
    s[z + X.right1] = r1;
    s[z + X.right2] = r2;
  }
  band.dirty = true;
}

/**
 * As `runSections`, while the band glides: each coefficient moves in a
 * straight line from `band.from` to `band.coeffs` across the piece, so a
 * refresh never steps the filter (a step would put a small edge into the
 * output every refresh, a buzz at the refresh rate). The line stays inside
 * the stability triangle, which is convex.
 */
export function glideSections(
  band: EqBand,
  left: Float64Array,
  right: Float64Array,
  frames: number,
): void {
  const c = band.coeffs;
  const f = band.from;
  const s = band.state;
  const inv = 1 / frames;
  for (let k = 0; k < band.sections; k++) {
    const o = k * PER;
    const z = k * ST;
    const d0 = (c[o + X.b0] - f[o + X.b0]) * inv;
    const d1 = (c[o + X.b1] - f[o + X.b1]) * inv;
    const d2 = (c[o + X.b2] - f[o + X.b2]) * inv;
    const e1 = (c[o + X.a1] - f[o + X.a1]) * inv;
    const e2 = (c[o + X.a2] - f[o + X.a2]) * inv;
    let b0 = f[o + X.b0];
    let b1 = f[o + X.b1];
    let b2 = f[o + X.b2];
    let a1 = f[o + X.a1];
    let a2 = f[o + X.a2];
    let l1 = s[z + X.left1];
    let l2 = s[z + X.left2];
    let r1 = s[z + X.right1];
    let r2 = s[z + X.right2];
    for (let i = 0; i < frames; i++) {
      b0 += d0;
      b1 += d1;
      b2 += d2;
      a1 += e1;
      a2 += e2;
      const xl = left[i];
      const yl = b0 * xl + l1;
      l1 = b1 * xl - a1 * yl + l2;
      l2 = b2 * xl - a2 * yl;
      left[i] = yl;
      const xr = right[i];
      const yr = b0 * xr + r1;
      r1 = b1 * xr - a1 * yr + r2;
      r2 = b2 * xr - a2 * yr;
      right[i] = yr;
    }
    s[z + X.left1] = l1;
    s[z + X.left2] = l2;
    s[z + X.right1] = r1;
    s[z + X.right2] = r2;
  }
  band.dirty = true;
}

/**
 * Mix `wet` (the band's output) against `dry` (its input) in place over
 * `frames` while the band fades: the gain is the smoothstep of the fade's
 * phase, which moves by `fadeDir × fadeStep` a sample from `band.fade`.
 * Written out rather than calling a helper per sample, so no double crosses
 * a call.
 */
export function mixFade(band: EqBand, wet: Float64Array, dry: Float64Array, frames: number): void {
  const step = band.fadeDir * band.fadeStep;
  for (let i = 0; i < frames; i++) {
    const phase = band.fade + step * (i + 1);
    const t = phase < 0 ? 0 : phase > 1 ? 1 : phase;
    const g = t * t * (M.three - 2 * t);
    wet[i] = dry[i] + g * (wet[i] - dry[i]);
  }
}
