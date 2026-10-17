/* eslint-disable no-magic-numbers -- DSP: mulberry32's own shifts and multipliers and the shapes' arithmetic; the tunables are delayConstants.ts */
/**
 * The Dub delay's motion (record `2026-10-17-dub-delay-regeneration`): one
 * LFO that wobbles both lines' times (Wow) and moves the loop filter's cutoff
 * (Sweep), its right side `stereoPhase` of a cycle ahead of its left. Four
 * shapes:
 *
 * - sine: a triangle bent round by t (3 − t²) / 2, a smooth sine-like swing
 *   from arithmetic alone;
 * - triangle;
 * - random: a new value each cycle, held;
 * - drift: the held values glided between, a slow irregular wander, as worn
 *   tape transport moves.
 *
 * Each side's output then passes a one-pole at about 40 Hz, so a held step or a
 * shape change moves the delay time smoothly rather than jumping. The random
 * values come from a mulberry32 generator seeded with `DELAY_DSP.seed`, its
 * state in an Int32Array so it never becomes a heap number; a render is
 * deterministic. `advance` reads its rate (cycles a sample) and shape from
 * fields and leaves `left` and `right`; it runs on every sample, awake or
 * asleep, so the motion's phase never depends on the sleep. Pinned by
 * inserts/delaySleep.test.ts and inserts/delayGolden.test.ts.
 */
import { DELAY_DSP as C, DELAY_WAVE_IDS as W } from '../../inserts/delayConstants';
import { exp2 } from '../../inserts/tapePortableMath';

/** The output smoother's corner, Hz; and mulberry32's increment and 2^−32. */
const MOTION_SMOOTH_HZ = 40;
const MULBERRY_STEP = 0x6d2b79f5;
const UNIT_SCALE = 1 / 4294967296;

class DelayMotion {
  /** Each side's phase, 0 to 1, its held random value, and its drift toward it. */
  readonly phase: Float64Array;
  readonly held: Float64Array;
  readonly drift: Float64Array;
  /** Each side's output before its smoother. */
  readonly raw: Float64Array;
  readonly state: Int32Array;
  readonly smooth: number;
  /** `advance`'s inputs: cycles a sample, and the shape's id. */
  rate: number;
  wave: number;
  /** Each side's output, −1 to 1. */
  left: number;
  right: number;

  constructor(sampleRate: number) {
    this.smooth = this.rate = this.wave = this.left = this.right = NaN;
    this.phase = new Float64Array(2);
    this.held = new Float64Array(2);
    this.drift = new Float64Array(2);
    this.raw = new Float64Array(2);
    this.state = new Int32Array(1);
    this.smooth = 1 - exp2((-2 * Math.PI * Math.LOG2E * MOTION_SMOOTH_HZ) / sampleRate);
    this.rate = 0;
    this.wave = W.drift;
    this.left = this.right = 0;
    this.state[0] = C.seed;
    this.phase[1] = C.stereoPhase;
    this.draw(0);
    this.draw(1);
  }

  /** A new held value, in [−1, 1), for side `side`: one mulberry32 step. */
  draw(side: number): void {
    const a = (this.state[0] = (this.state[0] + MULBERRY_STEP) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    this.held[side] = 2 * ((t ^ (t >>> 14)) >>> 0) * UNIT_SCALE - 1;
  }

  /** One sample of both sides. */
  advance(): void {
    const glide = Math.min(1, 2 * Math.PI * this.rate);
    for (let side = 0; side < 2; side++) {
      let phase = this.phase[side] + this.rate;
      if (phase >= 1) {
        phase -= Math.floor(phase);
        this.draw(side);
      }
      this.phase[side] = phase;
      this.drift[side] += glide * (this.held[side] - this.drift[side]);
      const tri = 1 - 4 * Math.abs(phase - 0.5);
      const wave = this.wave;
      this.raw[side] =
        wave === W.sine
          ? (tri * (3 - tri * tri)) / 2
          : wave === W.triangle
            ? tri
            : wave === W.random
              ? this.held[side]
              : this.drift[side];
    }
    this.left += this.smooth * (this.raw[0] - this.left);
    this.right += this.smooth * (this.raw[1] - this.right);
  }
}

export { DelayMotion };
