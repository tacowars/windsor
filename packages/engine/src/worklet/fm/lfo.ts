/* eslint-disable no-magic-numbers -- DSP: the xorshift shifts and the shape arithmetic are the algorithm; the tunables are fmConstants.ts (#654) */
/**
 * The per-voice LFO (#644): seven shapes over one phase, sample-and-hold and
 * drift from the voice's own xorshift32 stream, and a fade-in. Invariant:
 * allocation free, and the sine shape reads `SIN_TAB` so it is the operators'
 * sine to the bit. `fmProcessorModWheel.test.ts` and the golden test pin it.
 */

import type { LfoSettings } from '../../patch/patch';
import { TABLE_MASK, TABLE_SIZE } from './fmConstants';
import { LFO_DRIFT, LFO_SAW_DOWN, LFO_SAW_UP, LFO_SH, LFO_SQUARE, LFO_TRI } from './modeIds';
import { randomSeed32 } from './prng';
import { SIN_TAB } from './waveTables';

/* ------------------------------------------------------------------ *
 * LFO
 * ------------------------------------------------------------------ */

class Lfo {
  phase: number;
  value: number;
  held: number;
  target: number;
  fade: number;
  seed: number;

  constructor(random: () => number) {
    this.phase = 0;
    this.value = 0;
    this.held = 0;
    this.target = 0;
    this.fade = 0;
    this.seed = randomSeed32(random);
  }

  rand(): number {
    // xorshift32 — deterministic, allocation free
    let x = this.seed;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    this.seed = x;
    return x / 0xffffffff;
  }

  reset(retrigger: boolean): void {
    if (retrigger) this.phase = 0;
    this.fade = 0;
    this.held = this.rand() * 2 - 1;
    this.target = this.rand() * 2 - 1;
  }

  advance(p: LfoSettings, n: number, sampleRate: number): number {
    const prev = this.phase;
    this.phase += (p.rate * n) / sampleRate;
    const wrapped = this.phase >= 1;
    if (wrapped) this.phase -= Math.floor(this.phase);

    switch (p.shape) {
      case LFO_TRI:
        this.value = 4 * Math.abs(this.phase - 0.5) - 1;
        break;
      case LFO_SAW_UP:
        this.value = this.phase * 2 - 1;
        break;
      case LFO_SAW_DOWN:
        this.value = 1 - this.phase * 2;
        break;
      case LFO_SQUARE:
        this.value = this.phase < 0.5 ? 1 : -1;
        break;
      case LFO_SH:
        if (wrapped || this.phase < prev) this.held = this.rand() * 2 - 1;
        this.value = this.held;
        break;
      case LFO_DRIFT:
        if (wrapped || this.phase < prev) {
          this.held = this.target;
          this.target = this.rand() * 2 - 1;
        }
        this.value = this.held + (this.target - this.held) * this.phase;
        break;
      default:
        this.value = SIN_TAB[(this.phase * TABLE_SIZE) & TABLE_MASK];
        break;
    }

    if (p.delay > 0) {
      this.fade = Math.min(1, this.fade + n / (p.delay * sampleRate));
    } else {
      this.fade = 1;
    }
    return this.value * this.fade;
  }
}

export { Lfo };
