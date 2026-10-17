/**
 * Spectre's input modulation stage (record `2026-10-16-spectre-insert`):
 * one channel's state and the dispatch to the algorithm the `mod` param
 * names, run on each analysed frame before the band delays. The algorithms
 * are functions over this object, frame-local ones in `spectreModsFrame.ts`
 * and those that keep frames in `spectreModsTime.ts`; every buffer they use
 * is here, sized at construction for the largest frame.
 *
 * Index order is `SPECTRE_MODS`'s: 0 off, 1 blur, 2 holes, 3 invert, 4 shift,
 * 5 comb, 6 gate, 7 pulse, 8 scatter, 9 phase, 10 swell, 11 smudge. A change
 * of algorithm clears the state (`reset`), so a return starts fresh.
 *
 * Invariants: nothing allocates after construction and no double crosses a
 * call: the amounts are fields, the bands the FFT's arrays (worklet rule 2).
 * Pinned by `inserts/spectreMods.test.ts`.
 */
import { SPECTRE_DSP } from '../../inserts/spectreConstants';
import {
  blurFrame,
  combFrame,
  gateFrame,
  holesFrame,
  invertFrame,
  phaseFrame,
  shiftFrame,
} from './spectreModsFrame';
import { swellFrame, pulseFrame, scatterFrame, smudgeFrame } from './spectreModsTime';
import type { SpectreRandom, SpectreTurns } from './spectreTurns';

const MOD_BLUR = 1,
  MOD_HOLES = 2,
  MOD_INVERT = 3,
  MOD_SHIFT = 4,
  MOD_COMB = 5,
  MOD_GATE = 6,
  MOD_PULSE = 7,
  MOD_SCATTER = 8,
  MOD_PHASE = 9,
  MOD_SWELL = 10,
  MOD_SMUDGE = 11;

class SpectreMods {
  readonly random: SpectreRandom;
  readonly turns: SpectreTurns;
  /** The algorithm, and its three amounts in 0..1. */
  mod: number;
  a: number;
  b: number;
  c: number;
  /** The frame's hop in seconds, for the algorithms that run in time. */
  hopSeconds: number;
  /** Each band's magnitude, a running sum over them, and the frame's largest. */
  readonly mags: Float64Array;
  readonly sums: Float64Array;
  peak: number;
  /** Scratch bands, for the algorithms that move bands. */
  readonly tempRe: Float64Array;
  readonly tempIm: Float64Array;
  /** holes: which bands are holed, and the frames until the next draw. */
  readonly holed: Uint8Array;
  holeWait: number;
  /** phase: each band's turn, an index into `turns`. */
  readonly turnOf: Int32Array;
  /** pulse: each band's accumulator, and where in its period the frame is. */
  readonly accRe: Float64Array;
  readonly accIm: Float64Array;
  pulseAt: number;
  /** scatter: frames ahead, band-interleaved, and the one heard now. */
  readonly ahead: Float32Array;
  aheadAt: number;
  /** smudge: the last frames, and the one written next. */
  readonly kept: Float32Array;
  keptAt: number;
  /** swell: its cycle's phase, in turns. */
  swellPhase: number;
  /** The frame stride of `ahead` and `kept`: twice the most bands. */
  readonly stride: number;
  /** swell's band positions, on the curves' axis. */
  axis: Float64Array;

  constructor(maxBands: number, random: SpectreRandom, turns: SpectreTurns) {
    this.a = this.b = this.c = this.hopSeconds = this.peak = this.swellPhase = NaN;
    this.random = random;
    this.turns = turns;
    this.stride = 2 * maxBands;
    this.mags = new Float64Array(maxBands);
    this.sums = new Float64Array(maxBands + 1);
    this.tempRe = new Float64Array(maxBands);
    this.tempIm = new Float64Array(maxBands);
    this.holed = new Uint8Array(maxBands);
    this.turnOf = new Int32Array(maxBands);
    this.accRe = new Float64Array(maxBands);
    this.accIm = new Float64Array(maxBands);
    this.ahead = new Float32Array(SPECTRE_DSP.scatterFrames * this.stride);
    this.kept = new Float32Array(SPECTRE_DSP.smudgeFrames * this.stride);
    this.axis = new Float64Array(maxBands);
    this.mod = 0;
    this.a = this.b = this.c = 0.5;
    this.hopSeconds = 0;
    this.peak = this.swellPhase = 0;
    this.holeWait = this.pulseAt = this.aheadAt = this.keptAt = 0;
  }

  /** Every algorithm's state back to rest. */
  reset(): void {
    this.holed.fill(0);
    this.turnOf.fill(0);
    this.accRe.fill(0);
    this.accIm.fill(0);
    this.ahead.fill(0);
    this.kept.fill(0);
    this.holeWait = this.pulseAt = this.aheadAt = this.keptAt = 0;
    this.swellPhase = 0;
  }

  /** The algorithm `mod` on the frame's `bands` bands, in place. */
  run(re: Float64Array, im: Float64Array, bands: number): void {
    const mod = this.mod;
    if (mod === MOD_BLUR) blurFrame(this, re, im, bands);
    else if (mod === MOD_HOLES) holesFrame(this, re, im, bands);
    else if (mod === MOD_INVERT) invertFrame(this, re, im, bands);
    else if (mod === MOD_SHIFT) shiftFrame(this, re, im, bands);
    else if (mod === MOD_COMB) combFrame(this, re, im, bands);
    else if (mod === MOD_GATE) gateFrame(this, re, im, bands);
    else if (mod === MOD_PULSE) pulseFrame(this, re, im, bands);
    else if (mod === MOD_SCATTER) scatterFrame(this, re, im, bands);
    else if (mod === MOD_PHASE) phaseFrame(this, re, im, bands);
    else if (mod === MOD_SWELL) swellFrame(this, re, im, bands);
    else if (mod === MOD_SMUDGE) smudgeFrame(this, re, im, bands);
  }
}

export { SpectreMods };
