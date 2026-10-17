/* eslint-disable no-magic-numbers -- DSP: swell's (1 + sin) / 2 is the raised sine's arithmetic; the ranges are SPECTRE_MOD_TUNING */
/**
 * The input modulations that keep frames (record
 * `2026-10-16-spectre-insert`), functions over `SpectreMods` that reshape a
 * frame's `bands` bands in place from what earlier frames left. Amounts `a`,
 * `b`, `c` are 0..1, ranges in `SPECTRE_MOD_TUNING` and `SPECTRE_DSP`:
 *
 * - **pulse** (Rate, Width, Feedback): each band sums into its own
 *   accumulator, fed back by up to 0.95; a gate opens for Width of every
 *   Rate-long period (1 to 64 frames) and lets the accumulators through,
 *   scaled back by the feedback's gain, and is closed for the rest.
 * - **scatter** (Distance, Rate): each band, with probability Rate, is sent
 *   ahead by a random number of frames up to Distance (at most 31) instead of
 *   heard now; what lands on a frame sums, and a band nothing reached is
 *   silent.
 * - **swell** (Depth, Speed, Spread): a sine moving across the bands at Speed
 *   (0.05 Hz up nine octaves), Spread cycles across the axis, cuts each band
 *   by up to Depth: a moving ripple through the spectrum.
 * - **smudge** (Position, Span): the last 64 frames are kept, and the frame
 *   heard is the one Position of Span frames back; moving Position scrubs.
 *
 * Invariants: nothing allocates and no double crosses a call (worklet rule 2).
 * Pinned by `inserts/spectreMods.test.ts`.
 */
import { SPECTRE_DSP, SPECTRE_MOD_TUNING } from '../../inserts/spectreConstants';
import { exp2InPlace } from '../fm/portablePowers';
import type { SpectreMods } from './spectreMods';

function pulseFrame(m: SpectreMods, re: Float64Array, im: Float64Array, bands: number): void {
  const T = SPECTRE_MOD_TUNING,
    accRe = m.accRe,
    accIm = m.accIm;
  const period = 1 + Math.round(m.a * m.a * (T.pulseFrames - 1));
  const width = Math.round(m.b * period);
  const open = m.pulseAt < (width < 1 ? 1 : width);
  const feedback = m.c * T.pulseFeedback,
    gain = 1 - feedback;
  for (let k = 0; k < bands; k++) {
    const ar = re[k] + feedback * accRe[k],
      ai = im[k] + feedback * accIm[k];
    accRe[k] = ar;
    accIm[k] = ai;
    re[k] = open ? ar * gain : 0;
    im[k] = open ? ai * gain : 0;
  }
  const next = m.pulseAt + 1;
  m.pulseAt = next >= period ? 0 : next;
}

function scatterFrame(m: SpectreMods, re: Float64Array, im: Float64Array, bands: number): void {
  const frames = SPECTRE_DSP.scatterFrames,
    wrap = frames - 1,
    stride = m.stride,
    ahead = m.ahead,
    random = m.random;
  const distance = 1 + Math.round(m.a * (frames - 2)),
    rate = m.b,
    now = m.aheadAt;
  for (let k = 0; k < bands; k++) {
    let slot = now;
    random.next();
    if (random.value < rate) {
      random.next();
      slot = (now + 1 + Math.floor(random.value * distance)) & wrap;
    }
    const at = slot * stride + 2 * k;
    ahead[at] += re[k];
    ahead[at + 1] += im[k];
  }
  const base = now * stride;
  for (let k = 0; k < bands; k++) {
    const at = base + 2 * k;
    re[k] = ahead[at];
    im[k] = ahead[at + 1];
    ahead[at] = 0;
    ahead[at + 1] = 0;
  }
  m.aheadAt = (now + 1) & wrap;
}

function swellFrame(m: SpectreMods, re: Float64Array, im: Float64Array, bands: number): void {
  const T = SPECTRE_MOD_TUNING,
    turns = m.turns,
    table = turns.table,
    mask = turns.mask,
    size = turns.size,
    axis = m.axis,
    slot = m.sums;
  slot[0] = m.b * T.swellOctaves;
  exp2InPlace(slot, 0);
  let phase = m.swellPhase + T.swellLowHz * slot[0] * m.hopSeconds;
  phase -= Math.floor(phase);
  m.swellPhase = phase;
  const cycles = m.c * T.swellCycles,
    depth = 0.5 * m.a;
  for (let k = 0; k < bands; k++) {
    const turn = Math.floor((phase + cycles * axis[k]) * size) & mask;
    const keep = 1 - depth * (1 + table[turn]);
    re[k] *= keep;
    im[k] *= keep;
  }
}

function smudgeFrame(m: SpectreMods, re: Float64Array, im: Float64Array, bands: number): void {
  const frames = SPECTRE_DSP.smudgeFrames,
    wrap = frames - 1,
    stride = m.stride,
    kept = m.kept;
  const span = 2 + Math.round(m.b * (frames - 2));
  const back = Math.round(m.a * (span - 1)),
    now = m.keptAt;
  const write = now * stride;
  for (let k = 0; k < bands; k++) {
    kept[write + 2 * k] = re[k];
    kept[write + 2 * k + 1] = im[k];
  }
  const read = ((now - back) & wrap) * stride;
  for (let k = 0; k < bands; k++) {
    re[k] = kept[read + 2 * k];
    im[k] = kept[read + 2 * k + 1];
  }
  m.keptAt = (now + 1) & wrap;
}

export { swellFrame, pulseFrame, scatterFrame, smudgeFrame };
