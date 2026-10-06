/**
 * The Filter insert's sweep across a quantum (windsor#622 decision 5): the
 * params are k-rate, one value a quantum, and the DSP retunes every
 * `CTRL_INTERVAL` frames, the voice's fast interval, so a quantum is four
 * pieces. Piece j of n plays the point (j + 1) / n of the way from the last
 * quantum's value to this one's: the cutoff geometrically, the Reso
 * linearly. The last piece is the new value itself, so a held value is
 * exact in every piece and no pow is taken for it.
 *
 * Invariants: allocates nothing, and no double crosses a call (worklet
 * rule 2): the ends are written into the glide's fields and the piece's
 * values are left in `cutoff` and `resonance`; every double field is born
 * NaN (rule 7). `filterGlide.test.ts` pins the points.
 */

class FilterGlide {
  /** The last quantum's values, and this one's. */
  cutoffFrom: number;
  cutoffTo: number;
  resonanceFrom: number;
  resonanceTo: number;
  /** The piece's values, which `glidePiece` writes. */
  cutoff: number;
  resonance: number;

  constructor() {
    // Rule 7: each double field is born a double (NaN), before its start value.
    this.cutoffFrom = this.cutoffTo = this.resonanceFrom = this.resonanceTo = NaN;
    this.cutoff = this.resonance = NaN;
    this.cutoffFrom = this.cutoffTo = this.cutoff = 0;
    this.resonanceFrom = this.resonanceTo = this.resonance = 0;
  }
}

/** Piece `piece` of `pieces`: its cutoff and Reso into `cutoff` and `resonance`. */
function glidePiece(glide: FilterGlide, piece: number, pieces: number): void {
  const last = piece + 1 >= pieces;
  const t = (piece + 1) / pieces;
  const c0 = glide.cutoffFrom,
    c1 = glide.cutoffTo;
  // A cutoff from 0 or below has no geometric path; it lands at once.
  glide.cutoff = last || c0 === c1 || !(c0 > 0) ? c1 : c0 * Math.pow(c1 / c0, t);
  const r0 = glide.resonanceFrom,
    r1 = glide.resonanceTo;
  glide.resonance = last || r0 === r1 ? r1 : r0 + (r1 - r0) * t;
}

/** The quantum is over: the next one glides from where this one landed. */
function landGlide(glide: FilterGlide): void {
  glide.cutoffFrom = glide.cutoffTo;
  glide.resonanceFrom = glide.resonanceTo;
}

export { FilterGlide, glidePiece, landGlide };
