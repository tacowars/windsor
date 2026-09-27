/**
 * The operator ratio as the console shows it (#587): a whole-number
 * **Coarse** and a fractional **Fine** over the one stored `ops.<i>.ratio`
 * field. Coarse is the multiple of the played note — the harmonic series is
 * where the usable FM sounds are — and Fine is the inharmonic offset within
 * that step. Nothing here is the modulation index: that is `level`.
 *
 * No engine or schema change comes with this. `ratio` remains the single
 * stored number; this module is only the console's view of it, so the whole
 * model is `floor` on the way apart and `+` on the way back together:
 *
 *   split(r) = { coarse: floor(r), fine: r - floor(r) }
 *   join(c, f) = clamp(c + f)
 *
 * which round-trips every stored value **exactly**. For r >= 1, `r - floor(r)`
 * is exact by Sterbenz's lemma (floor(r) <= r < 2*floor(r)), and adding an
 * exact difference back reproduces r bit for bit; below 1 the coarse part is 0
 * and nothing is subtracted at all. So a patch nobody touched exports the
 * ratio it was loaded with — 5.242900000000001 stays 5.242900000000001 — and
 * rounding happens only where it always has, on a knob's commit (`knob.ts`).
 *
 * Fine is capped one step below a whole number so a knob never carries into
 * the next: turning Fine up at 0.999 stays at 0.999 and Coarse does not move.
 */

/**
 * The stored field's range. The floor is the console's alone — the engine and
 * `patchNormalise` accept any positive ratio — and sits four octaves under the
 * note, two under the drum bodies that `drum-bank-ratio-floor` pinned at 0.25
 * (Pat, 2026-09-18; `2026-09-18-618-console-ratio-floor-and-the-tools-lint-fence`).
 */
export const RATIO_MIN = 0.0625;
export const RATIO_MAX = 24;

export const COARSE_MIN = 0;
export const COARSE_MAX = 24;
export const COARSE_STEP = 1;
export const COARSE_DEF = 1;

export const FINE_MIN = 0;
/** One Fine step below 1: the pair clamps rather than carrying (#587). */
export const FINE_MAX = 0.999;
export const FINE_STEP = 0.001;
export const FINE_DEF = 0;

export interface RatioSplit {
  /** The whole multiple of the note; 0 carries the sub-ratios 0.25 and 0.5. */
  readonly coarse: number;
  /** The remainder, in [0, 1). */
  readonly fine: number;
}

/** The stored field's own range — what both knobs ultimately write through. */
export const clampRatio = (ratio: number): number =>
  Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio));

/** A stored ratio as the two knobs read it. Exact: see the file header. */
export function split(ratio: number): RatioSplit {
  const coarse = Math.floor(ratio);
  return { coarse, fine: ratio - coarse };
}

/** The two knobs' positions as one stored ratio. */
export const join = (coarse: number, fine: number): number => clampRatio(coarse + fine);

/**
 * Turning Coarse: the fraction stays where it was, capped at the pair's own
 * Fine maximum. The cap is not cosmetic. A stored ratio a hair under a whole
 * number — `0.9999999999999999`, which a hand-written document can hold even
 * though no knob can produce it — carries a fraction so close to 1 that adding
 * it to the requested coarse rounds past it: `1 + 0.9999999999999999` is
 * exactly `2` in double precision, so asking for Coarse 1 would land on Coarse
 * 2 with Fine zeroed (Codex pass 1, P2). `FINE_MAX` is the largest fraction
 * the pair can represent anyway, and capping there keeps the result inside the
 * step the user asked for — the whole promise of a coarse knob.
 */
export const withCoarse = (ratio: number, coarse: number): number =>
  join(
    Math.min(COARSE_MAX, Math.max(COARSE_MIN, Math.round(coarse))),
    Math.min(FINE_MAX, split(ratio).fine),
  );

/** Turning Fine: the whole step stays where it was, and Fine never carries. */
export const withFine = (ratio: number, fine: number): number =>
  join(split(ratio).coarse, Math.min(FINE_MAX, Math.max(FINE_MIN, fine)));

/** Coarse 0 is not a multiple at all — it is where 0.25 and 0.5 live. */
export const fmtCoarse = (v: number): string => (v < COARSE_DEF ? 'sub' : v.toFixed(0));

const RATIO_DECIMALS = 3;
export const fmtFine = (v: number): string => v.toFixed(RATIO_DECIMALS);
/** The combined value the bay reads out, in the stored field's own terms. */
export const fmtRatio = (v: number): string => v.toFixed(RATIO_DECIMALS);
