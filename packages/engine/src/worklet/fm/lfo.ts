/* eslint-disable no-magic-numbers -- DSP: the xorshift shifts and the shape arithmetic are the algorithm; the tunables are fmConstants.ts (#654) */
/**
 * The per-voice LFO (#644): seven shapes over one phase, sample-and-hold and
 * drift from the LFO's own xorshift32 stream, a fade-in, and (#55) one-shot
 * and unipolar modes. A voice runs two (`lfo`, `lfo2`); the second is seeded
 * from the first by `secondLfoSeed`, never from the part's random stream, so
 * adding it moved no other draw. Invariant: allocation free, and the sine
 * shape reads `SIN_TAB` so it is the operators' sine to the bit. `lfo.test.ts`,
 * `fmProcessorModWheel.test.ts`, `__fixtures__/lfo2Routes.test.ts` and the
 * golden test pin it.
 */

import type { LfoSettings } from '../../patch/patch';
import { TABLE_MASK, TABLE_SIZE } from './fmConstants';
import { LFO_DRIFT, LFO_SAW_DOWN, LFO_SAW_UP, LFO_SH, LFO_SQUARE, LFO_TRI } from './modeIds';
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

  /** `seed` is a non-zero xorshift32 state: `randomSeed32`, or `secondLfoSeed` of another LFO's. */
  constructor(seed: number) {
    this.phase = 0;
    this.value = 0;
    this.held = 0;
    this.target = 0;
    this.fade = 0;
    this.seed = seed;
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

  /**
   * Advance by `n` samples and return the value, faded in. A one-shot LFO's
   * phase stops at 1 and holds there, so it never wraps and every shape holds
   * its end value (#55); `start` resets it at note-on. Unipolar remaps the
   * shape's -1..1 to 0..1 before the fade, so the fade-in scales up from 0.
   */
  advance(p: LfoSettings, n: number, sampleRate: number): number {
    const prev = this.phase;
    this.phase += (p.rate * n) / sampleRate;
    let wrapped = false;
    if (this.phase >= 1) {
      if (p.oneShot) {
        this.phase = 1;
      } else {
        wrapped = true;
        this.phase -= Math.floor(this.phase);
      }
    }

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
    if (p.unipolar) return ((this.value + 1) / 2) * this.fade;
    return this.value * this.fade;
  }
}

/**
 * LFO 2's seed from LFO 1's (#55): one xorshift32 step of the seed mixed with
 * the golden-ratio constant, so the two streams differ without a new draw
 * from the part's random source. The draw order is what keeps every seeded
 * render, the goldens included, where it was: a new draw would shift each
 * later voice's phases, noise and pan. Zero, xorshift's fixed point, maps to 1.
 */
function secondLfoSeed(seed: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;
  x >>>= 0;
  return x || 1;
}

export { Lfo, secondLfoSeed };
