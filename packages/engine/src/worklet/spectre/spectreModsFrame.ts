/**
 * The input modulations that work within a frame (record
 * `2026-10-16-spectre-insert`), functions over `SpectreMods` that reshape a
 * frame's `bands` bands in place. Amounts `a`, `b`, `c` are 0..1, ranges in
 * `SPECTRE_MOD_TUNING`:
 *
 * - **blur** (Amount, Width, Jitter): each band's magnitude moves toward the
 *   mean of the bands `Width` either side, its phase kept; Jitter turns each
 *   band by a fresh random angle, up to half a cycle each way.
 * - **holes** (Depth, Density, Length): a fresh random set of bands, up to
 *   half of them, cut by Depth, drawn anew every Length frames.
 * - **invert** (Threshold, Amount): bands louder than `(1 − Threshold)` of
 *   the frame's loudest are turned over toward `loudest − magnitude`.
 * - **shift** (Shift): every band moved up or down by up to a quarter of the
 *   bands, the vacated ones silent: inharmonic, like a ring modulator.
 * - **comb** (Depth, Spacing, Offset): from the Offset band up, only every
 *   Spacing-th band passes whole; the rest are cut by Depth.
 * - **gate** (Threshold, Depth, Invert): bands under a threshold up to 60 dB
 *   below the frame's loudest are cut by Depth; Invert cuts the loud ones.
 * - **phase** (Amount, Rate): each band holds a random turn of up to
 *   Amount × half a cycle, redrawn on each frame with probability Rate.
 *
 * Invariants: nothing allocates and no double crosses a call (worklet rule 2).
 * Pinned by `inserts/spectreMods.test.ts`.
 */
import { SPECTRE_DSP, SPECTRE_MOD_TUNING } from '../../inserts/spectreConstants';
import { exp2InPlace } from '../fm/portablePowers';
import type { SpectreMods } from './spectreMods';

const SPECTRE_GATE_LOG2_10_OVER_20 = 0.16609640474436813;

/** Each band's magnitude into `mags`, and the largest into `peak`. */
function measure(m: SpectreMods, re: Float64Array, im: Float64Array, bands: number): void {
  const mags = m.mags;
  let peak = 0;
  for (let k = 0; k < bands; k++) {
    const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    mags[k] = mag;
    if (mag > peak) peak = mag;
  }
  m.peak = peak;
}

function blurFrame(m: SpectreMods, re: Float64Array, im: Float64Array, bands: number): void {
  measure(m, re, im, bands);
  const mags = m.mags,
    sums = m.sums,
    turns = m.turns,
    table = turns.table,
    random = m.random;
  const width = 1 + Math.round(m.b * (SPECTRE_MOD_TUNING.blurWidthBands - 1));
  const amount = m.a,
    jitter = m.c * SPECTRE_MOD_TUNING.maxTurn * turns.size;
  sums[0] = 0;
  for (let k = 0; k < bands; k++) sums[k + 1] = sums[k] + mags[k];
  for (let k = 0; k < bands; k++) {
    const lo = k - width < 0 ? 0 : k - width,
      hi = k + width + 1 > bands ? bands : k + width + 1;
    const mag = mags[k];
    const target = mag + amount * ((sums[hi] - sums[lo]) / (hi - lo) - mag);
    let xr = target,
      xi = 0;
    if (mag > 0) {
      const scale = target / mag;
      xr = re[k] * scale;
      xi = im[k] * scale;
    }
    if (jitter > 0) {
      random.next();
      const turn = Math.round((2 * random.value - 1) * jitter) & turns.mask;
      const c = table[(turn + turns.quarter) & turns.mask],
        s = table[turn];
      const tr = xr * c - xi * s;
      xi = xr * s + xi * c;
      xr = tr;
    }
    re[k] = xr;
    im[k] = xi;
  }
}

function holesFrame(m: SpectreMods, re: Float64Array, im: Float64Array, bands: number): void {
  const T = SPECTRE_MOD_TUNING,
    holed = m.holed,
    random = m.random;
  if (m.holeWait <= 0) {
    holed.fill(0, 0, bands);
    const count = Math.round(m.b * m.b * T.holeShare * bands);
    for (let i = 0; i < count; i++) {
      random.next();
      holed[1 + Math.floor(random.value * (bands - 1))] = 1;
    }
    m.holeWait = 1 + Math.round(m.c * m.c * (T.holeFrames - 1));
  }
  m.holeWait--;
  const keep = 1 - m.a;
  for (let k = 0; k < bands; k++) {
    if (holed[k] === 0) continue;
    re[k] *= keep;
    im[k] *= keep;
  }
}

function invertFrame(m: SpectreMods, re: Float64Array, im: Float64Array, bands: number): void {
  measure(m, re, im, bands);
  const mags = m.mags,
    peak = m.peak,
    amount = m.b;
  const threshold = peak * (1 - m.a);
  for (let k = 0; k < bands; k++) {
    const mag = mags[k];
    if (mag <= threshold || mag <= 0) continue;
    const scale = (mag + amount * (peak - 2 * mag)) / mag;
    re[k] *= scale;
    im[k] *= scale;
  }
}

function shiftFrame(m: SpectreMods, re: Float64Array, im: Float64Array, bands: number): void {
  const T = SPECTRE_MOD_TUNING;
  const shift = Math.round((m.a - T.centre) * 2 * T.shiftShare * bands);
  if (shift === 0) return;
  const tempRe = m.tempRe,
    tempIm = m.tempIm;
  for (let k = 0; k < bands; k++) {
    tempRe[k] = re[k];
    tempIm[k] = im[k];
  }
  for (let k = 0; k < bands; k++) {
    const from = k - shift;
    const inside = from >= 0 && from < bands;
    re[k] = inside ? tempRe[from] : 0;
    im[k] = inside ? tempIm[from] : 0;
  }
}

function combFrame(m: SpectreMods, re: Float64Array, im: Float64Array, bands: number): void {
  const spacing = 2 + Math.round(m.b * m.b * (SPECTRE_MOD_TUNING.combSpacing - 2));
  const offset = Math.round(m.c * m.c * m.c * bands),
    keep = 1 - m.a;
  for (let k = offset, step = 0; k < bands; k++, step++) {
    if (step === spacing) step = 0;
    if (step === 0) continue;
    re[k] *= keep;
    im[k] *= keep;
  }
}

function gateFrame(m: SpectreMods, re: Float64Array, im: Float64Array, bands: number): void {
  measure(m, re, im, bands);
  const slot = m.sums;
  slot[0] = -(1 - m.a) * SPECTRE_MOD_TUNING.gateRangeDb * SPECTRE_GATE_LOG2_10_OVER_20;
  exp2InPlace(slot, 0);
  const threshold = m.peak * slot[0],
    mags = m.mags,
    keep = 1 - m.b,
    invert = m.c >= SPECTRE_DSP.switchOn;
  for (let k = 0; k < bands; k++) {
    if (mags[k] >= threshold !== invert) continue;
    re[k] *= keep;
    im[k] *= keep;
  }
}

function phaseFrame(m: SpectreMods, re: Float64Array, im: Float64Array, bands: number): void {
  const turns = m.turns,
    table = turns.table,
    mask = turns.mask,
    random = m.random,
    turnOf = m.turnOf;
  const reach = m.a * SPECTRE_MOD_TUNING.maxTurn * turns.size,
    rate = m.b;
  for (let k = 0; k < bands; k++) {
    random.next();
    if (random.value < rate) {
      random.next();
      turnOf[k] = Math.round((2 * random.value - 1) * reach);
    }
    const turn = turnOf[k] & mask;
    if (turn === 0) continue;
    const c = table[(turn + turns.quarter) & mask],
      s = table[turn];
    const xr = re[k],
      xi = im[k];
    re[k] = xr * c - xi * s;
    im[k] = xr * s + xi * c;
  }
}

export {
  blurFrame,
  combFrame,
  gateFrame,
  holesFrame,
  invertFrame,
  measure,
  phaseFrame,
  shiftFrame,
};
