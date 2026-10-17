/* eslint-disable no-magic-numbers -- DSP: the half cycle and the triangle's 4x − 1 and 3 − 4x are the shapes' arithmetic */
/**
 * Spectre's LFO (record `2026-10-16-spectre-insert`): one bipolar
 * oscillator, stepped once a frame (the curves' own rate), that moves the
 * delay curve's offset, the gain curve's shift and the first modulation
 * amount by their depths. Shapes by `SPECTRE_LFO_SHAPES` index: 0 sine, 1
 * triangle, 2 saw (rising), 3 square, 4 random (a fresh level each cycle,
 * held). Its phase runs on while the insert sleeps (the sleep rule).
 *
 * Invariants: `advance` allocates nothing and leaves its level in `value`
 * (worklet rule 2); the sine comes from `SpectreTurns`, the same bits on
 * arm64 and x64. Pinned by `inserts/spectreDsp.test.ts`.
 */
import type { SpectreRandom, SpectreTurns } from './spectreTurns';

const LFO_SINE = 0,
  LFO_TRIANGLE = 1,
  LFO_SAW = 2,
  LFO_SQUARE = 3;

class SpectreLfo {
  readonly turns: SpectreTurns;
  readonly random: SpectreRandom;
  shape: number;
  hz: number;
  hopSeconds: number;
  /** Where in the cycle, 0..1. */
  phase: number;
  /** The random shape's held level. */
  held: number;
  value: number;

  constructor(turns: SpectreTurns, random: SpectreRandom) {
    this.hz = this.hopSeconds = this.phase = this.held = this.value = NaN;
    this.turns = turns;
    this.random = random;
    this.shape = 0;
    this.hz = this.hopSeconds = this.phase = this.held = this.value = 0;
  }

  reset(): void {
    this.phase = 0;
    this.held = 0;
  }

  /** One frame on: `value` is the level at the new phase. */
  advance(): void {
    let phase = this.phase + this.hz * this.hopSeconds;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      this.random.next();
      this.held = 2 * this.random.value - 1;
    }
    this.phase = phase;
    const shape = this.shape;
    if (shape === LFO_SINE) {
      const turns = this.turns;
      this.value = turns.table[Math.floor(phase * turns.size) & turns.mask];
    } else if (shape === LFO_TRIANGLE) {
      this.value = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
    } else if (shape === LFO_SAW) {
      this.value = 2 * phase - 1;
    } else if (shape === LFO_SQUARE) {
      this.value = phase < 0.5 ? 1 : -1;
    } else {
      this.value = this.held;
    }
  }
}

export { SpectreLfo };
